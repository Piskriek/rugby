/**
 * T-69 PROBE v2 — during every restart FLIGHT, track the minimum distance
 * from any player of each side to the live ball. If the receiving side's
 * minimum never drops near zero, the flight steering never moves them.
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const matches = Number(process.argv[2] ?? 3);
const dt = 1 / 60;

for (let m = 0; m < matches; m++) {
  const d = new Director(gateConfig(9));
  let inFlight = false, kickTeam: 'A' | 'B' = 'A';
  let minK = 999, minR = 999, frames = 0;
  let ko = 0;
  for (let i = 0; i < 100 * 60; i++) {
    if (d.kk && (d.kk.type === 'RESTART' || d.kk.type === 'DROP_OUT') && d.kk.stage === 'FLIGHT') {
      if (!inFlight) { inFlight = true; kickTeam = d.kk.kicker; minK = 999; minR = 999; frames = 0; }
      for (const p of d.live) {
        if (p.sinbin > 0 || p.down) continue;
        const dd = Math.hypot(p.x - d.kk.bx, p.z - d.kk.bz);
        if (p.team === kickTeam) { if (dd < minK) minK = dd; }
        else if (dd < minR) minR = dd;
      }
      frames++;
    } else if (inFlight) {
      inFlight = false;
      ko++;
      const outcome = d.possession === kickTeam ? 'KICKER' : 'RECEIVER';
      console.log(`ko${ko}: frames=${frames} minDist kickerSide=${minK.toFixed(1)} m recvSide=${minR.toFixed(1)} m -> ${outcome}`);
    }
    d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false }, new Set(), new Set());
  }
}
