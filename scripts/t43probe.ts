/**
 * T-43 PROBE — "replay after a lineout" + "teleported to the opponent 22".
 *
 * Two suspects:
 *  A) a watchdog trip() firing in/after a lineout (the PLAY RESET banner reads
 *     like a replay, and the restart mark lands wherever the focus was —
 *     plausibly the opponent 22);
 *  B) the TMO corner-grounding hold after a lineout drive-try (4.2 s of
 *     "TMO CHECKING" that a player could describe as a replay).
 *
 * Runs full CPU matches at difficulty 9 and reports every trip with the phase
 * it happened in plus how recently a LINEOUT/MAUL phase ran, every TMO with
 * the try's origin, and every >8 m single-frame displacement within 3 s of a
 * trip (the "teleport").
 *
 * Usage: npx vite-node scripts/t43probe.ts [matches] [difficulty]
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const matches = Number(process.argv[2] ?? 8);
const diff = Number(process.argv[3] ?? 9);
const dt = 1 / 60;
const SPEED = 9; // clockScale at long halves; game-seconds per real second

let tripsAfterLineout = 0, tmoAfterLineout = 0, teleports = 0, totalTrips = 0, totalTmo = 0;

for (let m = 0; m < matches; m++) {
  const d = new Director(gateConfig(diff));
  let lastLineoutAt = -99;
  let lastLineoutEndAt = -99;
  const prevPos = new Map<string, { x: number; z: number }>();
  for (const p of d.live) prevPos.set(`${p.team}${p.num}`, { x: p.x, z: p.z });
  const recentTeleport = { t: -99 };

  for (let i = 0; i < 100 * 60; i++) {
    for (const p of d.live) {
      const k = `${p.team}${p.num}`;
      const pr = prevPos.get(k)!;
      const disp = Math.hypot(p.x - pr.x, p.z - pr.z);
      if (disp > 8 && d.clock - recentTeleport.t < 3 * SPEED) {
        teleports++;
        console.log(`  [m${m}] TELEPORT ${Math.round(disp)} m: ${p.team}${p.num} at ${d.clockText} (phase ${d.phase})`);
      }
      pr.x = p.x; pr.z = p.z;
    }
    const wasPhase = d.phase;
    const wasLog = d.watchdogLog.length;
    const wasTmo = !!d.tmo;
    d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false }, new Set(), new Set());

    if (wasPhase === 'LINEOUT' && d.phase !== 'LINEOUT') lastLineoutEndAt = d.clock;
    if (d.phase === 'LINEOUT' && wasPhase !== 'LINEOUT') lastLineoutAt = d.clock;

    if (d.watchdogLog.length > wasLog) {
      const line = d.watchdogLog[d.watchdogLog.length - 1];
      const since = d.clock - lastLineoutEndAt;
      totalTrips++;
      if (since >= 0 && since < 12 * SPEED) tripsAfterLineout++;
      console.log(`  [m${m}] TRIP @${d.clockText} after ${wasPhase}: ${line} (lineout ended ${since.toFixed(1)} game-s ago)`);
      recentTeleport.t = d.clock;
    }
    if (d.tmo && !wasTmo) {
      totalTmo++;
      const since = d.clock - lastLineoutEndAt;
      if (since >= 0 && since < 25 * SPEED) tmoAfterLineout++;
      console.log(`  [m${m}] TMO @${d.clockText} (lineout ended ${since.toFixed(1)} game-s ago)`);
    }
  }
}

console.log(`\nT-43 PROBE — ${matches} matches @ diff ${diff}`);
console.log(`trips total=${totalTrips}  within 12s of a lineout=${tripsAfterLineout}`);
console.log(`tmo checks total=${totalTmo}  within 25s of a lineout=${tmoAfterLineout}`);
console.log(`single-frame >8 m displacements near resets=${teleports}`);
