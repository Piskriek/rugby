/**
 * T-12 acceptance — persistence.
 *
 * Usage: npx vite-node scripts/persisttest.ts
 *
 *  1. Round trip: write a kicker of 12, load — kicker unchanged.
 *  2. Corruption: smash the key with garbage — load returns null (defaults),
 *     no throw, and a subsequent boot works normally.
 *  3. Version guard: a future-version blob is refused.
 */
import { loadSave, writeSave, clearSave } from '../src/game/persist';

// minimal localStorage shim for headless run
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};

let fails = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; };

// 1. round trip
writeSave({
  v: 1,
  squads: { home: 'FRA', away: 'WAL', kitA: 1, kitB: 0 },
  tactics: {
    sliders: { aggression: 80 },
    form: { backline: 'BL-BLITZ', defence: 'DF-RUSH', lineout: 'LO-7', scrum: 'SC-8-3' },
    assists: { pass: 0.4, tackle: 0.9, kick: 0.6 },
  },
  kickers: { kickerA: 12 },
  options: { difficulty: 2 },
  classicProgress: 'CM-03',
});
const a = loadSave();
check('kicker round-trips (12)', a?.kickers.kickerA === 12);
check('squad round-trips (FRA/WAL, kit 1)', a?.squads.home === 'FRA' && a?.squads.away === 'WAL' && a?.squads.kitA === 1);
check('tactics round-trip (BL-BLITZ, aggression 80)', a?.tactics.form.backline === 'BL-BLITZ' && a?.tactics.sliders.aggression === 80);
check('classic progress round-trips (CM-03)', a?.classicProgress === 'CM-03');

// 2. corruption
store.set('rugby.save', '{{{ not json at all');
let threw = false;
let b = null as ReturnType<typeof loadSave>;
try { b = loadSave(); } catch { threw = true; }
check('corrupt blob does not throw', !threw);
check('corrupt blob yields defaults (null)', b === null);
writeSave({ v: 1, squads: { home: 'ENG', away: 'NZL', kitA: 0, kitB: 0 }, tactics: { sliders: {}, form: { backline: 'BL-SPLIT', defence: 'DF-UMBRELLA', lineout: 'LO-5', scrum: 'SC-8-3' }, assists: { pass: 0.7, tackle: 0.7, kick: 0.7 } }, kickers: { kickerA: 10 }, options: {}, classicProgress: null });
check('boot works after corruption cleared', loadSave()?.kickers.kickerA === 10);

// 3. version guard
store.set('rugby.save', JSON.stringify({ v: 2, squads: {}, tactics: {}, kickers: {}, options: {} }));
check('future-version blob refused', loadSave() === null);

// 4. clear
clearSave();
check('clear removes the key', loadSave() === null);

process.exit(fails ? 1 : 0);
