import { runDeep } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
for (const diff of [0, 3, 6]) {
  seedRng(diff);
  const r = runDeep(gateConfig(diff), 100);
  const cams = r.diags.filter(d => d.kind === 'CAMERA' && /OUT cam|BEHIND/.test(d.detail));
  console.log('diff', diff, 'offTarget', r.offTargetFrames, 'poss', r.possessionChanges,
    'tackles', r.tacklesMade, 'chases', r.chaseArrivals, 'camlog', cams.length);
  for (const c of cams.slice(0, 4)) console.log('   ', c.t, c.detail.slice(0, 160));
}
