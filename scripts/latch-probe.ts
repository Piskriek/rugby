/**
 * Latch micro-probe — FIRST BREAKDOWN CAPTURE.
 *
 * The old version built a tackle by hand and never actually created one
 * (carrier/tackler 31.9 m apart). The right way to observe a real tackle is
 * to let the Director make one: run a seeded match, wait for the first
 * breakdown object, then freeze-frame the pile through the tackle stages.
 *
 * Output per frame: stage, carrier/tackler distance and speeds, joints,
 * peak penetration, tackle-bind strain — the physics the T-80 refactor is
 * measured by (binds close, bodies fall together, nothing interpenetrates).
 *
 * Usage: npx vite-node scripts/latch-probe.ts [seed]
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seed = Number(process.argv[2] ?? 1);
seedRng(seed);
const d = new Director(gateConfig(3));
const dt = 1 / 60;

let frames = 0, inBd = false;
let captured = 0;
while (!d.over && frames < 60 * 700) {
  frames++;
  const hasBd = !!d.bd;
  if (!inBd && hasBd && captured < 2) {
    inBd = true;
    captured++;
    const s = d.bd;
    console.log(`\n=== breakdown #${captured} at t=${d.t.toFixed(1)}s seed=${seed} ===`);
    let step = 0;
    while (d.bd && step < 60 * 6) {
      step++;
      const c = d.latches.byKind('CARRIER');
      const k = d.latches.byKind('TACKLER');
      const ball = d.latches.byKind('BALL');
      const m = d.latches.metrics;
      const dOrig = c && k ? Math.hypot(k.x - c.x, k.z - c.z) : 0;
      const tj = d.latches.joints.find((j) => j.kind === 'TACKLE');
      const pre = d.bd;
      if (step <= 6 || step % 12 === 0) {
        console.log(
          `f${step} stage=${d.bd.stage} d=${dOrig.toFixed(2)} `
          + `car=(${c?.x.toFixed(1)},${c?.z.toFixed(1)})v${Math.hypot(c?.vx ?? 0, c?.vz ?? 0).toFixed(1)} `
          + `tac=(${k?.x.toFixed(1)},${k?.z.toFixed(1)})v${Math.hypot(k?.vx ?? 0, k?.vz ?? 0).toFixed(1)} `
          + `joints=${d.latches.joints.length}/${d.latches.bodies.length} `
          + `strain=${tj ? tj.strain.toFixed(2) : '-'} pen=${m.maxPenetration.toFixed(2)} `
          + `t=${d.bd.t.toFixed(2)}g=${d.bd.groundAt.toFixed(2)}w=${d.bd.waggle.toFixed(1)}`,
        );
      }
      d.update(dt, NO_INPUT, new Set());
      if (!d.bd && pre) {
        console.log(`  -> exit reason: ${pre.resultWhy || pre.result || '(none)'} stage=${pre.stage}`);
      }
    }
    console.log(`episode ended ${d.bd ? `stage=${d.bd.stage}` : 'closed'} phase=${d.phase} joints=${d.latches.joints.length} feed=${d.feed[0]?.text ?? ''}`);
    inBd = false;
    if (captured >= 2) break;
  }
  d.update(dt, NO_INPUT, new Set());
}
if (captured === 0) console.log('no breakdown within the sim window');
