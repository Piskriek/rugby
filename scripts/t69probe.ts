/**
 * T-69 PROBE — kickoff ownership. For every RESTART/DROP_OUT strike, record
 * which side next gains possession via startOpen (kicker side = the chasing
 * team; receiving side = honest field). A kicking side winning far above 50%
 * (with the receiver steered to the ball every frame) is the "opponents just
 * watch it" bug.
 *
 * Also logs the receiver's distance to the ball at the catch frame.
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const matches = Number(process.argv[2] ?? 6);
const dt = 1 / 60;

let kickWins = 0, recWins = 0, kickoffs = 0;
let recDistSum = 0, recDistN = 0;

for (let m = 0; m < matches; m++) {
  const d = new Director(gateConfig(9));
  let pending: 'KICK' | 'RECEIVE' | null = null;
  let kickTeam: 'A' | 'B' = 'A';
  let ballAt = { x: 0, z: 0 };
  for (let i = 0; i < 100 * 60; i++) {
    // snapshot: a restart just went airborne?
    if (d.kk && (d.kk.type === 'RESTART' || d.kk.type === 'DROP_OUT') && d.kk.stage === 'FLIGHT' && !pending) {
      pending = 'KICK';
      kickTeam = d.kk.kicker;
      ballAt = { x: d.kk.bx, z: d.kk.bz };
    }
    if (pending && !d.kk) {
      // flight ended: who got it? (possession side of the new state)
      const kicker: 'A' | 'B' = kickTeam;
      if (d.possession === kicker) { kickWins++; }
      else {
        recWins++;
        const rec = d.live.find((p) => p.team === d.possession && p.num === d.op?.carrierNum);
        if (rec) {
          const dd = Math.hypot(rec.x - ballAt.x, rec.z - ballAt.z);
          recDistSum += dd; recDistN++;
          if (dd > 6) console.log(`  [m${m}] far-award: carrier ${d.possession}${rec.num} ${dd.toFixed(1)} m from the mark, ball at (${d.op?.ball.x.toFixed(1)},${d.op?.ball.z.toFixed(1)}) op.t=${d.op?.t.toFixed(2)} receipt=${d.receipt ? 'yes' : 'no'}`);
        }
      }
      kickoffs++;
      pending = null;
    }
    d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false }, new Set(), new Set());
  }
}
console.log(`kickoffs=${kickoffs}  kicker side won=${kickWins}  receiving side won=${recWins}  (${Math.round((kickWins / Math.max(1, kickoffs)) * 100)}% to the chasers)`);
if (recDistN) console.log(`avg distance of the receiver from the landing mark when he DID take it: ${(recDistSum / recDistN).toFixed(1)} m`);
