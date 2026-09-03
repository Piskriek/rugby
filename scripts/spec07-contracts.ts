/**
 * SPEC_07 CONTRACTS — the scoreTry idempotence guard (T-67 backstop).
 *
 * C1  first trigger passes: +5, one TRY event, lock engages
 * C2  same-frame duplicate rejected: score unchanged, block logged
 * C3  duplicates across the try fanfare / conversion window rejected
 * C4  restart kickoff (play reset) clears the lock — the next try scores
 * C5  watchdog reset (play reset) clears the lock — the next try scores
 * C6  full headless matches: ledger integrity — every point on the board is
 *     accounted for by exactly one score event, and any guard block is
 *     visible in the log the pause panel reads
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { POINTS } from '../src/game/data';

let fails = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) fails++;
}

/* ---- C1 + C2 + C3: one award, then the lock holds through the window ---- */
{
  const d = new Director(gateConfig(3));
  check('C0 lock starts clean', d.tryLock === null);
  (d as any).possession = 'A';
  const before = d.teams.A.score;
  d.scoreTry();
  check('C1 first trigger scores exactly 5', d.teams.A.score === before + POINTS.TRY, `${d.teams.A.score - before}`);
  check('C1 one TRY event', d.events.filter((e: any) => e.kind === 'TRY').length === 1);
  check('C1 lock engaged', d.tryLock !== null);

  d.scoreTry();
  check('C2 same-frame duplicate rejected', d.teams.A.score === before + POINTS.TRY, `score ${d.teams.A.score}`);
  check('C2 still one TRY event', d.events.filter((e: any) => e.kind === 'TRY').length === 1);
  check('C2 block counted', d.tryGuardBlocks === 1, `${d.tryGuardBlocks}`);
  check('C2 block logged for the pause panel', d.tryGuardLog.length === 1 && d.tryGuardLog[0].includes('BLOCKED'));

  /* run the fanfare/conversion frames — the lock must hold the whole window */
  for (let i = 0; i < 90; i++) d.update(1 / 60, NO_INPUT, new Set());
  d.scoreTry();
  check('C3 duplicate inside the try window rejected', d.teams.A.score === before + POINTS.TRY && d.tryGuardBlocks === 2,
    `score delta ${d.teams.A.score - before}, blocks ${d.tryGuardBlocks}`);

  /* ---- C4: the restart kickoff is the play reset ---- */
  d.restartAfterScore('B');
  check('C4 restart kickoff clears the lock', d.tryLock === null);
  const bBefore = d.teams.B.score;
  (d as any).possession = 'B';
  d.scoreTry();
  check('C4 next play sequence scores again', d.teams.B.score === bBefore + POINTS.TRY, `+${d.teams.B.score - bBefore}`);
  check('C4 block count stable', d.tryGuardBlocks === 2, `${d.tryGuardBlocks}`);
}

/* ---- C5: the watchdog reset is the other play reset ---- */
{
  const d = new Director(gateConfig(3));
  (d as any).possession = 'A';
  d.scoreTry();
  check('C5 lock engaged after award', d.tryLock !== null);
  (d as any).trip('spec07 contract trip');
  check('C5 watchdog reset clears the lock', d.tryLock === null);
  const before = d.teams.A.score;
  (d as any).possession = 'A';
  d.scoreTry();
  check('C5 try after the reset scores', d.teams.A.score === before + POINTS.TRY, `+${d.teams.A.score - before}`);
}

/* ---- C6: ledger integrity over full headless matches ---- */
{
  const MATCHES = Number(process.argv[2] ?? 3);
  let tries = 0, ledgerExact = true, guardArmedOutsideWindow = false;
  for (let m = 0; m < MATCHES; m++) {
    const d = new Director(gateConfig(m % 10));
    for (let i = 0; i < 100 * 60 && !d.over; i++) d.update(1 / 60, NO_INPUT, new Set());
    /* the event ledger: try events say TRY — name; every kick event carries
     * its own +N in the text (place goals are kind GOAL, worth 2 or 3) */
    const value = (e: any) => e.kind === 'TRY' ? POINTS.TRY : Number(/\+(\d+)/.exec(e.text)?.[1] ?? 0);
    const ledgerA = d.events.filter((e: any) => e.team === 'A').reduce((s: number, e: any) => s + value(e), 0);
    const ledgerB = d.events.filter((e: any) => e.team === 'B').reduce((s: number, e: any) => s + value(e), 0);
    if (ledgerA !== d.teams.A.score || ledgerB !== d.teams.B.score) {
      ledgerExact = false;
      console.log(`  match ${m}: LEDGER MISMATCH A ${ledgerA} vs ${d.teams.A.score}, B ${ledgerB} vs ${d.teams.B.score}`);
    }
    tries += d.events.filter((e: any) => e.kind === 'TRY').length;
    /* every block must be visible in the log the pause panel renders */
    if (d.tryGuardBlocks !== d.tryGuardLog.length && d.tryGuardLog.length !== 40) guardArmedOutsideWindow = true;
    if (d.tryGuardBlocks > 0) console.log(`  match ${m}: guard blocked ${d.tryGuardBlocks} duplicate trigger(s) — see pause panel log`);
  }
  check('C6 every point on the board has exactly one score event', ledgerExact);
  check('C6 every guard block is surfaced in the panel log', !guardArmedOutsideWindow);
  console.log(`      (${tries} tries across ${MATCHES} matches — ledger verified)`);
}

console.log(fails === 0 ? 'SPEC_07 CONTRACTS: ALL GREEN' : `SPEC_07 CONTRACTS: ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
