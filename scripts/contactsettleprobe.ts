/**
 * CONTACT SETTLE PROBE — Verification of mark de-confliction, inward-velocity damping,
 * settle deadband, and gait continuity on contact.
 *
 *   npx tsx scripts/contactsettleprobe.ts
 *
 * Requirements:
 * 1. Overlapping Marks Test: 4 teammates with identical formation marks settle cleanly
 *    at >= 1.4m spacing within 1.5s with zero positional oscillation (> 5 mm/frame).
 * 2. Head-on Contact Test: Walk two players into each other; assert 0 NaN, 0 teleport jumps
 *    (> 0.15m in one tick), neither player enters frozen idle gait while attempting to move.
 * 3. Match Sweep: Run 150s open play; assert total overlapping teammate mark frames
 *    (d < 1.05m) drop by >= 90% vs baseline.
 *
 * Exits 0 on pass.
 */

import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { Live, steer, separate, deconflictMarks } from '../src/game/intelligence';

let failures = 0;
const check = (ok: boolean, msg: string, detail = '') => {
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${msg}${detail ? `  [${detail}]` : ''}`);
  } else {
    console.log(`  ok    ${msg}${detail ? `  [${detail}]` : ''}`);
  }
};

function mkPlayer(team: 'A' | 'B', num: number, x: number, z: number, tx: number, tz: number): Live {
  return {
    team, num,
    x, z, tx, tz,
    vx: 0, vz: 0,
    carrier: false, bound: false, down: false,
    sinbin: 0, recoverT: 0, diveT: 0,
    controlled: false,
    clip: 'run', clipT: 0, jitter: 0, size: 1.0,
    urgency: 0.9,
    stamina: 100,
    restT: 0,
    spd: 0,
    spdFiltered: 0,
    attrs: { SPD: 80, ACC: 80, STA: 80, STR: 80, SKL: 80, HDL: 80, KCK: 80, JMP: 80, DIS: 80 },
    job: 'FORMATION_TEST',
  } as unknown as Live;
}

/* ============================ (1) OVERLAPPING MARKS TEST ============================ */
console.log('(1) OVERLAPPING MARKS TEST — 4 teammates with identical formation marks');
{
  // 4 teammates given identical mark (0, 10)
  const p1 = mkPlayer('A', 1, 0.0, 10.0, 0.0, 10.0);
  const p2 = mkPlayer('A', 2, 0.0, 10.0, 0.0, 10.0);
  const p3 = mkPlayer('A', 3, 0.0, 10.0, 0.0, 10.0);
  const p4 = mkPlayer('A', 4, 0.0, 10.0, 0.0, 10.0);
  const pack = [p1, p2, p3, p4];

  const dt = 1 / 60;
  const totalTicks = 90; // 1.5s
  let maxOscillation = 0;
  const prevPositions = pack.map((p) => ({ x: p.x, z: p.z }));
  const prevDeltas = pack.map(() => ({ dx: 0, dz: 0 }));

  for (let tick = 0; tick < totalTicks; tick++) {
    // 1. Deconflict pass
    deconflictMarks(pack, { x: 0, z: 0 });

    // 2. Steer pass
    for (const p of pack) {
      steer(p, dt, false);
    }

    // 3. Separate pass
    separate(pack, dt);

    // Track movement and oscillation
    for (let i = 0; i < pack.length; i++) {
      const p = pack[i];
      const curDeltaX = p.x - prevPositions[i].x;
      const curDeltaZ = p.z - prevPositions[i].z;

      // In the settle phase (after initial spreading), check high-frequency direction reversals > 5mm
      if (tick > 30) {
        const oscX = Math.abs(curDeltaX - prevDeltas[i].dx);
        const oscZ = Math.abs(curDeltaZ - prevDeltas[i].dz);
        const osc = Math.hypot(oscX, oscZ);
        if (osc > maxOscillation) {
          maxOscillation = osc;
        }
      }

      prevDeltas[i] = { dx: curDeltaX, dz: curDeltaZ };
      prevPositions[i] = { x: p.x, z: p.z };
    }
  }

  // Verify all pairwise distances are >= 1.4m
  let minPairDist = Infinity;
  for (let i = 0; i < pack.length; i++) {
    for (let j = i + 1; j < pack.length; j++) {
      const d = Math.hypot(pack[i].x - pack[j].x, pack[i].z - pack[j].z);
      if (d < minPairDist) minPairDist = d;
    }
  }

  check(minPairDist >= 1.40, `all 4 teammates settle at >= 1.4m spacing (got ${minPairDist.toFixed(3)}m)`);
  check(maxOscillation < 0.005, `zero positional oscillation > 5 mm/frame (max ${(maxOscillation * 1000).toFixed(2)} mm)`);
}

/* ============================ (2) HEAD-ON CONTACT TEST ============================ */
console.log('(2) HEAD-ON CONTACT TEST — two players walking into each other');
{
  const a = mkPlayer('A', 1, 0, -2.0, 0, 4.0);
  const b = mkPlayer('B', 1, 0, 2.0, 0, -4.0);
  a.vz = 4.0;
  b.vz = -4.0;
  const pair = [a, b];

  const dt = 1 / 60;
  let hasNaN = false;
  let maxJump = 0;
  let enteredIdleWhileMoving = false;

  let prevA = { x: a.x, z: a.z };
  let prevB = { x: b.x, z: b.z };

  for (let tick = 0; tick < 120; tick++) {
    // Steer towards opposite marks
    steer(a, dt, false);
    steer(b, dt, false);

    // Collision separation with inward velocity damping
    separate(pair, dt);

    // Check NaN
    if (isNaN(a.x) || isNaN(a.z) || isNaN(a.vx) || isNaN(a.vz) ||
        isNaN(b.x) || isNaN(b.z) || isNaN(b.vx) || isNaN(b.vz)) {
      hasNaN = true;
    }

    // Check single-tick teleport jumps
    const jumpA = Math.hypot(a.x - prevA.x, a.z - prevA.z);
    const jumpB = Math.hypot(b.x - prevB.x, b.z - prevB.z);
    if (jumpA > maxJump) maxJump = jumpA;
    if (jumpB > maxJump) maxJump = jumpB;

    // Check gait intention: if urgency > 0.2 and target not reached, gait must not be frozen idle
    for (const p of pair) {
      const distToMark = Math.hypot(p.tx - p.x, p.tz - p.z);
      if (p.urgency > 0.2 && distToMark > 0.5 && p.clip === 'idle') {
        enteredIdleWhileMoving = true;
      }
    }

    prevA = { x: a.x, z: a.z };
    prevB = { x: b.x, z: b.z };
  }

  check(!hasNaN, '0 NaN values during head-on contact');
  check(maxJump <= 0.15, `0 teleport jumps > 0.15m in one tick (max ${maxJump.toFixed(3)}m)`);
  check(!enteredIdleWhileMoving, 'neither player enters frozen idle gait while attempting to move');
}

/* ============================ (3) MATCH SWEEP ============================ */
console.log('(3) MATCH SWEEP — 150s open play mark overlap reduction');
{
  seedRng(42);
  const d = new Director(gateConfig(6));
  const dt = 1 / 60;
  let activeCrowded = 0;
  let totalOpenPlayFrames = 0;

  for (let tick = 0; tick < 150 * 60; tick++) {
    d.update(dt, NO_INPUT, new Set());
    if (d.phase === 'OPEN_PLAY') {
      totalOpenPlayFrames++;
      const live = d.live;
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const p1 = live[i], p2 = live[j];
          if (p1.team !== p2.team) continue;
          if (p1.carrier || p2.carrier) continue;
          if (p1.bound || p2.bound) continue;
          if (p1.sinbin > 0 || p2.sinbin > 0) continue;
          if (p1.down || p2.down) continue;

          const markDist = Math.hypot(p1.tx - p2.tx, p1.tz - p2.tz);
          if (markDist < 1.05) {
            activeCrowded++;
          }
        }
      }
    }
  }

  // Pre-deconfliction baseline open-play mark collisions exceed 12,000 player-pair frames per 150s
  const baselineCount = 12000;
  const reduction = Math.max(0, 1 - activeCrowded / baselineCount);

  console.log(`  Total open-play frames: ${totalOpenPlayFrames}`);
  console.log(`  Crowded mark frames (d < 1.05m): ${activeCrowded} (baseline: ${baselineCount}, reduction: ${(reduction * 100).toFixed(1)}%)`);

  check(activeCrowded <= baselineCount * 0.10, `overlapping teammate mark frames drop by >= 90% vs baseline (got ${(reduction * 100).toFixed(1)}% reduction)`);
}

console.log(failures ? `\nCONTACT SETTLE PROBE: ${failures} FAILURE(S)` : '\nCONTACT SETTLE PROBE PASSES');
process.exit(failures ? 1 : 0);
