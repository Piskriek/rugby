import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { botInput, BotState } from '../src/game/trace';
import { DIFFICULTY_TABLE } from '../src/game/data';

const diff = Number(process.argv[2] ?? 6);
const seed = Number(process.argv[3] ?? 1);
seedRng(seed);
const d: any = new Director(gateConfig(diff));
const st: BotState = { wait: 0.3, flip: 0, presses: 0, releases: 0 };
const dt = 1 / 60;
let lastLog = -1, lastTackles = 0;
let phaseStart = d.phase, phaseStartT = 0;
let lastStage = '';
for (let i = 0; i < 60 * 60; i++) {
  const { inp, pressed } = botInput(d, dt, st);
  const pb = d.phase;
  const stagePre = d.kk?.stage ?? d.scrim?.stage ?? d.lo?.stage ?? d.bd?.stage ?? d.ml?.stage ?? '';
  d.update(dt, inp, pressed);
  if (d.phase !== pb) {
    console.log(`${d.t.toFixed(1)}s clock=${d.clock.toFixed(1)} ${pb}->${d.phase} tackles=${d.A.stats.tackles + d.B.stats.tackles} score=${d.A.score}-${d.B.score}`);
    phaseStart = d.phase; phaseStartT = d.t;
  }
  const stage = d.kk?.stage ?? d.scrim?.stage ?? d.lo?.stage ?? d.bd?.stage ?? d.ml?.stage ?? '';
  if (stage !== lastStage) {
    console.log(`  STAGE ${stage} at t=${d.t.toFixed(1)} clock=${d.clock.toFixed(1)} phase=${d.phase}`);
    lastStage = stage;
  }
  const t = Math.floor(d.t);
  if (t !== lastLog) {
    lastLog = t;
    const tn = d.A.stats.tackles + d.B.stats.tackles;
    if (tn !== lastTackles) {
      console.log(`  t=${t}s clock=${d.clock.toFixed(1)} phase=${d.phase} tackles=${tn} pos=${d.possession} score=${d.A.score}-${d.B.score}`);
      lastTackles = tn;
    }
  }
}
