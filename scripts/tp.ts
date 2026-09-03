import { runDeep } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
for (let i = 0; i < 6; i++) {
  const r = runDeep(gateConfig(3), 60);
  const tps = r.diags.filter((x: any) => x.kind === 'TELEPORT');
  console.log(`run ${i}: teleports=${r.teleportCount} maxDisp=${r.maxFrameDisplacement}`);
  for (const t of tps.slice(0, 3)) console.log(`   ${t.detail} @t=${t.t}`);
}
