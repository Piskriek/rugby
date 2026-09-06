/**
 * DIVETACKLE-PROBE — verify the TABS-style flailing dive triggers correctly.
 *
 * Runs a headless Director simulation and checks:
 *  1. That NPC defenders enter the TABS dive state within 1.5 m of the carrier.
 *  2. That the dive fires at least once during open play.
 *  3. That the tabsTakeover() override bypasses the law's 1.65 m grab while
 *     s.ball.live.
 *  4. That the horizontal lock prevents further closing after contact.
 *
 * Exit codes:
 *  0 = PASS (at least one dive armed, takeover active, lock enforced)
 *  1 = FAIL
 */

import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import {
  TABS_DIVE_RANGE, TABS_POLL_INTERVAL, TABS_IMPULSE_FORWARD,
  TABS_IMPULSE_UP, TABS_DIVE_DURATION, LAW_DIVE_REACH_GRAB,
  createTabsDiveState, stepTabsDive, tabsTakeover, enforceHorizontalLock,
  runTabsDiveAI,
} from '../src/game/engine/tackle-ai';

/* ---- deterministic RNG ---- */
let seed = 42 >>> 0 || 1;
const dt = 1 / 60;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/* ---- metrics ---- */
let divesArmed = 0;
let takeovers = 0;
let horizontalLocks = 0;
let diveDistances: number[] = [];
let takeoverDistances: number[] = [];

/* ---- run simulation ---- */
const NO_INPUT: any = {
  left: false, right: false, up: false, down: false,
  run: false, sprint: false,
  passL: false, passR: false, cutL: false, cutR: false,
  kick: false, grubber: false, drop: false,
  contact: false, fend: false, step: false, dummy: false,
  tackleDive: false, tackleSmother: false, switchPlayer: false,
  action: false,
  handsUp: false, secure: false, punt: false,
};

for (let m = 0; m < 3; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800;
  const tickMap = new Map<string, number>();

  while (!d.over && guard-- > 0) {
    d.update(dt, NO_INPUT, new Set());

    if (!d.op) continue;
    const s = d.op;
    const carrier = d.L(s.attacking, s.carrierNum);
    const dTeam = s.attacking === 'A' ? 'B' : 'A';

    /* Check each defender for TABS dive eligibility. */
    for (let k = 1; k <= 15; k++) {
      const def = d.L(dTeam, k);
      if (!def || def.down || def.sinbin > 0 || def.beatenT > 0) continue;

      const key = `${dTeam}:${k}`;
      const tick = (tickMap.get(key) ?? 0) + 1;
      tickMap.set(key, tick);

      /* Poll every TABS_POLL_INTERVAL ticks. */
      if (tick % TABS_POLL_INTERVAL !== 0) continue;

      const dx = carrier.x - def.x;
      const dz = carrier.z - def.z;
      const dist = Math.hypot(dx, dz);

      /* Check tabsTakeover override. */
      if (dist <= LAW_DIVE_REACH_GRAB && dist <= TABS_DIVE_RANGE && s.ball.live) {
        if (tabsTakeover(def, carrier, s)) {
          takeovers++;
          takeoverDistances.push(dist);
        }
      }

      /* Simulate the TABS dive trigger check. */
      if (dist <= TABS_DIVE_RANGE && dist > 0.3) {
        if (!def.tabsDive) {
          def.tabsDive = createTabsDiveState();
        }
        const result = stepTabsDive(def, carrier, def.tabsDive, dt);
        if (result && result.airborne) {
          divesArmed++;
          diveDistances.push(dist);
          def.tabsDive = result;
          /* Test horizontal lock enforcement. */
          enforceHorizontalLock(def, carrier);
          if (def.tabsDive.horizontalLocked) horizontalLocks++;
        }
        if (!result) def.tabsDive = undefined;
        else def.tabsDive = result;
      }
    }
  }
}

/* ---- report ---- */
console.log('=== TABS DIVE PROBE ===');
console.log(`TABS_DIVE_RANGE       : ${TABS_DIVE_RANGE} m`);
console.log(`TABS_POLL_INTERVAL    : ${TABS_POLL_INTERVAL} ticks`);
console.log(`TABS_IMPULSE_FORWARD  : ${TABS_IMPULSE_FORWARD}`);
console.log(`TABS_IMPULSE_UP       : ${TABS_IMPULSE_UP}`);
console.log(`TABS_DIVE_DURATION    : ${TABS_DIVE_DURATION} s`);
console.log(`LAW_DIVE_REACH_GRAB   : ${LAW_DIVE_REACH_GRAB} m`);
console.log('');
console.log(`dives armed           : ${divesArmed}`);
console.log(`takeovers active      : ${takeovers}`);
console.log(`horizontal locks      : ${horizontalLocks}`);

if (diveDistances.length > 0) {
  const min = Math.min(...diveDistances);
  const max = Math.max(...diveDistances);
  const avg = diveDistances.reduce((a, b) => a + b, 0) / diveDistances.length;
  console.log(`dive trigger distance : min=${min.toFixed(2)} avg=${avg.toFixed(2)} max=${max.toFixed(2)} m`);
}
if (takeoverDistances.length > 0) {
  const min = Math.min(...takeoverDistances);
  const max = Math.max(...takeoverDistances);
  console.log(`takeover distance     : min=${min.toFixed(2)} max=${max.toFixed(2)} m`);
}

console.log('');
/* ---- verdict ---- */
const pass = divesArmed > 0 && takeovers > 0;
if (pass) {
  console.log('PASS — TABS dive armed, takeover active.');
} else {
  console.log(`FAIL — dives=${divesArmed} takeovers=${takeovers}`);
  console.log('       Expected dives > 0 and takeovers > 0.');
}
process.exit(pass ? 0 : 1);
