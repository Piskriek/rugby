import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const N = Number(process.argv[2] ?? 6);
const diff = Number(process.argv[3] ?? 3);
const shares: number[] = [];
for (let m = 0; m < N; m++) {
  const cfg = gateConfig(diff);
  cfg.homeId = 'ENG'; cfg.awayId = 'ENG';
  const d: any = new Director(cfg);
  while (!d.over) d.update(1 / 60, NO_INPUT, new Set());
  const A = d.A.stats, B = d.B.stats;
  const share = (100 * A.rucks / Math.max(1, A.rucks + B.rucks));
  shares.push(share);
  console.log(`m${m}: ${d.A.score}-${d.B.score} (A ruck ${share.toFixed(0)}%)`);
}
console.log('mean A share:', (shares.reduce((a, b) => a + b, 0) / N).toFixed(1) + '%');
console.log('shares:', shares.map((s) => s.toFixed(0)).join(','));
