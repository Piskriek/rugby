/**
 * Get up, then jog to the lineout. Unused defensive forwards spread.
 *
 * Usage: npx vite-node scripts/getupline.ts
 */
import { Director, NO_INPUT, quickStartConfig, RECOVER_SECONDS } from '../src/game/director';
import { FORWARDS } from '../src/game/intelligence';
import { seedRng } from '../src/game/seed';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(68)} ${detail}`);
}

/* ---- grounded men plant through the get-up, then walk to the throw-in ---- */
{
  seedRng(2);
  const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
  d.releaseAll();
  d.kk = undefined;
  for (const p of d.live) {
    p.x = (p.num - 8) * 1.6;
    p.z = p.team === 'A' ? -2 : 4;
    p.vx = 0; p.vz = 0; p.down = false; p.bound = false; p.recoverT = 0;
    p.clip = 'ready';
  }
  d.startOpen('A', 0, 0, 12, 1);
  d.startBreakdown(7);
  const grounded = [d.L('A', 4), d.L('A', 5), d.L('B', 6), d.L('B', 8)];
  for (const p of grounded) {
    p.down = true;
    p.clip = 'grounded';
    p.vx = 0; p.vz = 0;
  }
  d.startLineout('A', 18, 32);
  const origin = grounded.map((p) => ({ team: p.team, num: p.num, x: p.x, z: p.z }));

  let maxSlide = 0;
  let stillGetup = 0;
  const untilUp = RECOVER_SECONDS + 0.05;
  for (let i = 0; i < Math.round(untilUp * 60); i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    for (let k = 0; k < grounded.length; k++) {
      const p = grounded[k];
      const o = origin[k];
      if ((p.recoverT ?? 0) > 0) {
        const slide = Math.hypot(p.x - o.x, p.z - o.z);
        if (slide > maxSlide) maxSlide = slide;
        if (p.clip === 'getup') stillGetup++;
      }
    }
  }
  check('grounded men do not slide while getting up for a lineout', maxSlide < 0.12,
    `maxSlide=${maxSlide.toFixed(3)} m recover=${RECOVER_SECONDS}s`);
  check('the get-up lock survives the kick-to-touch / lineout hand-off', stillGetup > 30,
    `getupFrames=${stillGetup}`);

  const afterUp = grounded.map((p) => ({ team: p.team, num: p.num, x: p.x, z: p.z, recoverT: p.recoverT ?? 0 }));
  for (let i = 0; i < 90; i++) d.update(1 / 60, NO_INPUT, new Set());
  let walked = 0;
  for (let k = 0; k < grounded.length; k++) {
    const p = grounded[k];
    const a = afterUp[k];
    const moved = Math.hypot(p.x - a.x, p.z - a.z);
    if (moved > 0.8) walked++;
  }
  check('once on their feet they jog toward the lineout', walked >= 3,
    `walked=${walked}/4 afterUpRecover=${afterUp.map((q) => q.recoverT.toFixed(2)).join(',')}`);
}

/* ---- unused defensive forwards fan out behind a ruck, they do not huddle ---- */
{
  seedRng(2);
  const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
  d.releaseAll();
  d.kk = undefined;
  for (const p of d.live) {
    p.x = (p.num - 8) * 1.4;
    p.z = p.team === 'A' ? -1 : 3;
    p.vx = 0; p.vz = 0; p.down = false; p.bound = false; p.recoverT = 0;
  }
  d.startOpen('A', 0, 0, 12, 1);
  d.startBreakdown(7);

  for (let i = 0; i < 90 && d.bd; i++) d.update(1 / 60, NO_INPUT, new Set());

  const bound = new Set((d.bd?.players ?? []).filter((q) => q.team === 'B').map((q) => q.num));
  const unused = d.live.filter((p) => p.team === 'B' && FORWARDS.includes(p.num)
    && !bound.has(p.num) && p.sinbin <= 0 && !p.down);
  const xs = unused.map((p) => p.x).sort((a, b) => a - b);
  const span = xs.length ? xs[xs.length - 1] - xs[0] : 0;
  const txs = unused.map((p) => p.tx).sort((a, b) => a - b);
  const markSpan = txs.length ? txs[txs.length - 1] - txs[0] : 0;
  const jiggle = unused.filter((p) => Math.hypot(p.vx, p.vz) > 1.6
    && Math.hypot(p.tx - p.x, p.tz - p.z) < 2.2).length;

  console.log(`  unused B pack: n=${unused.length} nums=${unused.map((p) => p.num).join(',')} `
    + `span=${span.toFixed(1)} m markSpan=${markSpan.toFixed(1)} m jiggle=${jiggle} phase=${d.phase} bd=${!!d.bd}`);

  check('unused defensive forwards are given a wide channel (marks ≥ 22 m)', markSpan >= 22,
    `markSpan=${markSpan.toFixed(1)} m n=${unused.length}`);
  check('unused defensive forwards actually spread (≥ 16 m of grass)', span >= 16,
    `span=${span.toFixed(1)} m`);
  check('on-mark unused forwards do not jiggle in place', jiggle <= 1,
    `jiggle=${jiggle}`);
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
