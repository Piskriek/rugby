import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seed = Number(process.argv[2] ?? 1);
seedRng(seed);
const cfg = gateConfig(3);
cfg.homeId = 'ENG'; cfg.awayId = 'ENG';
const d: any = new Director(cfg);
console.log('teams', d.teams.A.id, d.teams.B.id);
let lastMin = -1;
let possessionSamples = { A: 0, B: 0 };
let scoreByMin: Array<string> = [];
while (!d.over) {
  d.update(1 / 60, NO_INPUT, new Set());
  possessionSamples[d.possession]++;
  const min = d.minute;
  if (min !== lastMin) {
    lastMin = min;
    scoreByMin.push(
      `${String(min).padStart(2)}:${String(d.A.score).padStart(2)}-${String(d.B.score).padStart(2)} ` +
      `pos=${d.possession} poss%(${(100 * possessionSamples.A / Math.max(1, possessionSamples.A + possessionSamples.B)).toFixed(0)})` +
      ` phases=${d.phasesGained}`
    );
  }
}
console.log(scoreByMin.join('\n'));
console.log('final', `${d.A.score}-${d.B.score}`, 'possess share',
  (100 * possessionSamples.A / Math.max(1, possessionSamples.A + possessionSamples.B)).toFixed(1) + '%');
