/**
 * SPEC_08 SMOKE — the stall presentation contract + the maulLaw=2 deprecation.
 *
 * Presentation:
 * S1  the USE IT call is dormant while the maul drives
 * S2  defence control: the countdown is the 5 s use-it whistle
 * S3  attack control: the countdown is the 6 s auto-exit (call your exit)
 * S4  the HUD narrative carries the persistent call while it is live
 *
 * Deprovercation (approved 2026-09-03):
 * S5  LAW-91 holds: the warn precedes the whistle in every mode
 * S6  legacy maulLaw=2 collapses to the STOP TWICE ladder (never a standstill)
 * S7  no mode stalls past the 15 s backstop without an award
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { maulUseItClock, maulUseItCall } from '../src/game/engine/setpieces';

let fails = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) fails++;
};

const d = new Director(gateConfig(3));
d.options.maulLaw = 0;
d.startMaul('A', 0, 20, 5, true);
const m = d.ml!;
check('S0 maul fixture live', !!m && m.exit === 'NONE');

/* S1 — driving: no call, no countdown on the HUD clock */
m.contest = 'ATTACK_CONTROL'; m.stage = 'ATTACK_CONTROL';
m.useItCalled = false; m.stallClock = 0; m.speed = 0.5;
check('S1 dormant while driving', !maulUseItCall(m) && d.narrative.now !== 'USE IT');

/* S2 — defence control: the number is the time to the whistle */
d.options.maulLaw = 0;
m.contest = 'DEFENCE_CONTROL'; m.stage = 'DEFENCE_HOLD';
m.useItCalled = true; m.warned = true; m.stallClock = 3.2; m.t = 6.0;
check('S2 defence control counts to the 5 s whistle', maulUseItClock(m) > 1.79 && maulUseItClock(m) < 1.81, `${maulUseItClock(m).toFixed(2)}`);
check('S2 call live', maulUseItCall(m));

/* S3 — attack control: the number is the time to the auto-exit */
m.contest = 'ATTACK_CONTROL'; m.stallClock = 3.0; m.t = 3.4;
check('S3 attack control counts to the 6 s auto-exit', maulUseItClock(m) > 2.59 && maulUseItClock(m) < 2.61, `${maulUseItClock(m).toFixed(2)}`);

/* S4 — the narrative channel carries the persistent call (clear the
 * constructor's idle kickoff first: a maul never coexists with a live kick) */
(d as any).kk = undefined;
const n = d.narrative;
check('S4 narrative says USE IT, red, with the clock', n.now === 'USE IT' && n.danger && n.clock > 0, `${n.now} / ${n.clock.toFixed(2)}`);

/* S5/S6/S7 — run a stalled defence-held maul to the award in every mode,
 * including legacy maulLaw=2 (deprecated: must collapse to the ladder) */
for (const law of [0, 1, 2] as const) {
  const e = new Director(gateConfig(3));
  e.options.maulLaw = law;
  e.startMaul('A', 0, 20, 5, true);
  const mm = e.ml!;
  mm.contest = 'DEFENCE_CONTROL'; mm.stage = 'DEFENCE_HOLD';
  mm.speed = 0; mm.stallClock = 0; mm.warned = false; mm.useItCalled = false;
  let warnedAt: number | null = null; let sawUseItClock = false; let frames = 0;
  while (mm.exit === 'NONE' && frames < 60 * 25) {
    e.update(1 / 60, NO_INPUT, new Set());
    frames++;
    if (mm.warned && warnedAt === null) warnedAt = mm.t;
    if (maulUseItCall(mm) && maulUseItClock(mm) > 0) sawUseItClock = true;
  }
  const label = law === 2 ? 'legacy law 2' : `law ${law}`;
  check(`S5 ${label}: resolved (${mm.exit}) with warn-first + live countdown`,
    mm.exit !== 'NONE' && warnedAt !== null && sawUseItClock,
    `exit=${mm.exit} warnedAt=${warnedAt ?? 'never'} countdownLive=${sawUseItClock}`);
  if (law === 2) {
    check('S6 legacy 2 collapses to the STOP TWICE ladder (penalty, not a standstill)',
      mm.exit === 'PENALTY_AWARDED' && mm.stoppedOnce,
      `exit=${mm.exit} stoppedOnce=${mm.stoppedOnce}`);
  }
  check(`S7 ${label}: awarded before the 15 s backstop`, mm.exit !== 'NONE' && frames / 60 < 15,
    `${(frames / 60).toFixed(1)}s`);
}

console.log(fails === 0 ? 'SPEC_08 SMOKE: ALL GREEN' : `SPEC_08 SMOKE: ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
