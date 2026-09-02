/** Sample the contest inside every ruck that runs long. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = Number(process.argv[3] ?? 11) >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const d = new Director(gateConfig(Number(process.argv[2] ?? 3)));
const dt = 1 / 60;
let guard = 60 * 60 * 8;
let shown = 0;
const curve: string[] = [];
let dead = false;
while (!d.over && guard-- > 0) {
  const bd = d.bd;
  if (bd && bd.stage === 'RUCK' && shown < 4 && (bd.t - bd.groundAt) > 2.0 && !dead) {
    const t = bd.t - bd.groundAt;
    if (t < 0.05) curve.length = 0;
    curve.push(`t=${t.toFixed(2)} ax=${bd.axis.toFixed(2)} A=${Math.round(bd.power.A)} B=${Math.round(bd.power.B)}`);
    if (Math.abs((t * 4) % 1) < dt * 4 && t > 0.2) {
      console.log(`ruck t=${t.toFixed(2)} axis=${bd.axis.toFixed(2)} atk=${Math.round(bd.power.A)} def=${Math.round(bd.power.B)} commitA=${bd.commitA} crew=${bd.crew.length} defCrew=${bd.defCrew.length} jackal=${bd.jackalActive}`);
    }
    if (t > 2.8) { console.log(curve.filter((_, i) => i % 12 === 0).join('\n')); console.log('---'); shown++; dead = true; }
  }
  d.update(dt, NO_INPUT, new Set());
}
