import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { passOptions } from '../src/game/intelligence';
const d = new Director(gateConfig(3));
const dt = 1 / 60;
let guard = 0, traced = 0;
while (!d.over && guard < 60 * 60 * 8 && traced < 3) {
  const wasCall = (d.feed[0]?.text ?? '').startsWith('CALL — WIDE SWEEP');
  d.update(dt, NO_INPUT, new Set());
  guard++;
  if (wasCall && d.op && !d.op.ball.live) {
    // trace this episode until it ends
    const s: any = d.op;
    let f = 0;
    while (d.phase === 'OPEN_PLAY' && d.op === s && f < 400) {
      const car = d.live.find((p) => p.team === s.attacking && p.num === s.carrierNum)!;
      const opts = passOptions(car, d.live, s.open, false, 0.2);
      if (f % 12 === 0) {
        const nearest = Math.min(...d.live.filter((p) => p.team !== s.attacking && p.sinbin <= 0).map((p) => Math.hypot(p.x - car.x, p.z - car.z)));
        console.log(`f${f} heldT=${s.heldT.toFixed(2)} prot=${s.protect.toFixed(2)} press=${s.pressure.toFixed(2)} near=${nearest.toFixed(1)} opts=${opts.length} timer=${s.aiTimer.toFixed(2)} intent=${s.aiIntent} carrier=${s.carrierNum}@${car.x.toFixed(0)},${car.z.toFixed(0)}`);
      }
      d.update(dt, NO_INPUT, new Set());
      f++;
    }
    console.log(`  -> episode ended in phase ${d.phase} after ${f} frames (${(f / 60).toFixed(1)}s), feed: ${d.feed[0]?.text}`);
    traced++;
  }
}
