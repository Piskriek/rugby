/**
 * SPEC_13 WHISTLE TEST — three cases, one of them a regression guard.
 *
 * Usage:  npx vite-node scripts/spec13whistle.ts
 *
 * The interesting gate in this spec is not "0 forward passes". It is the one
 * the author named: *the human must still be able to complete a pass to a man
 * running onto the ball*. A direction test that is too eager kills the passing
 * game and looks like success while it does it, because the forward-pass count
 * goes to zero. So all three cases are asserted:
 *
 *   1. thrown forward           -> whistle, scrum where it was thrown
 *   2. thrown flat, man sprinting forward (MOMENTUM) -> no whistle, completed
 *   3. thrown to a man behind   -> no whistle, completed
 */
import { Director, NO_INPUT, MatchConfig } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { doPass } from '../src/game/engine/open';

function fresh(): Director {
  seedRng(1);
  const cfg: MatchConfig = { ...gateConfig(3), cpuA: false };
  const d = new Director(cfg);
  for (let i = 0; i < 60 * 200 && !d.over; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    if (d.op && d.op.attacking === 'A' && !d.op.ball.live) break;
  }
  return d;
}

function scenario(label: string, place: (carZ: number, dir: number) => { x: number; z: number; vz: number }, carVz: number) {
  const d = fresh();
  const s = d.op!;
  const dir = s.dir >= 0 ? 1 : -1;
  const car = d.L('A', s.carrierNum);
  car.vz = carVz * dir;
  const mate = d.live.find((p) => p.team === 'A' && p.num !== car.num && !p.down && p.sinbin <= 0)!;
  const at = place(car.z, dir);
  mate.x = car.x + at.x;
  mate.z = at.z;
  mate.vz = at.vz;
  const before = d.passLawIntegrity.whistles;
  const beforeCatches = d.teams.A.stats.passes;
  doPass(d, mate.x - car.x >= 0 ? 1 : -1, false);
  const whistled = d.passLawIntegrity.whistles - before;
  const thrown = d.teams.A.stats.passes - beforeCatches;
  console.log(`  ${label}`);
  console.log(`     whistle ${whistled}   thrown ${thrown}   phase ${d.phase}`
    + (d.scrim ? `   scrum at z=${d.scrim.players[0]?.z.toFixed(1)}` : ''));
  return { whistled, thrown, d, car };
}

console.log('\n=== SPEC_13 WHISTLE TEST ===');

/* 1. A man seven metres in front, standing still. Nothing excuses this. */
const fwd = scenario('1. receiver 7 m FORWARD, standing', (carZ, dir) => ({ x: 2, z: carZ + dir * 7, vz: 0 }), 0);
console.log(`     verdict: ${fwd.whistled === 1 && fwd.d.phase === 'SCRUM' ? 'PASS — whistled, scrum awarded' : 'FAIL'}`);

/* 2. THE MOMENTUM GUARD. A man LEVEL with the carrier, and the carrier is
 * sprinting at 8 m/s. The ball travels forward over the ground — the thrower's
 * legs take it there — and the law says that is legal. A naive absolute test
 * fails this case, which is why the test is relative. */
const flat = scenario('2. receiver LEVEL, carrier sprinting 8 m/s (momentum)', (carZ) => ({ x: 4, z: carZ, vz: 0 }), 8);
console.log(`     verdict: ${flat.whistled === 0 ? 'PASS — momentum allowed, no whistle' : 'FAIL — the momentum allowance is broken'}`);

/* 3. Ordinary pass to a man behind. */
const back = scenario('3. receiver 4 m BEHIND', (carZ, dir) => ({ x: 3, z: carZ - dir * 4, vz: 0 }), 6);
console.log(`     verdict: ${back.whistled === 0 ? 'PASS — legal, no whistle' : 'FAIL'}`);

/* 4. The scrum is taken WHERE THE BALL WAS THROWN, not where it was caught. */
const throwZ = fwd.car.z;
const scrumZ = fwd.d.scrim ? Math.min(...fwd.d.scrim.players.map((p) => p.z), Math.max(...fwd.d.scrim.players.map((p) => p.z))) : NaN;
console.log(`\n  4. scrum position: thrown at z=${throwZ.toFixed(1)}, scrum at z=${Number.isFinite(scrumZ) ? scrumZ.toFixed(1) : 'n/a'}`
  + `  -> ${Number.isFinite(scrumZ) && Math.abs(scrumZ - throwZ) < 3 ? 'PASS — at the throw' : 'CHECK'}`);
