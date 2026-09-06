/**
 * T-80 breakdown audit — the ground truth for the tackle/ruck work.
 *
 * Edge detection is grounded in the STATE OBJECT (`d.bd`), not the phase
 * string: startBreakdown creates the object, so entry == one tackle episode
 * exactly, and every exit is one of the engine's own terminal paths. Each
 * episode is classified by what actually changed (stats) and by the engine's
 * written reason, so the outcome ledger is exactly the game's accounting.
 *
 * Output: outcome distribution + pacing + realism-relevant totals, across
 * `matches` full seeded matches (default 4, diff 3).
 *
 * Usage: npx vite-node scripts/t80audit.ts [matches] [diff] [seedBase]
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const matches = Number(process.argv[2] ?? 4);
const DIFF = Number(process.argv[3] ?? 3);
const seedBase = Number(process.argv[4] ?? 7000);
const dt = 1 / 60;

let tot = { ep: 0, ruck: 0, turn: 0, pen: 0, stall: 0, misc: 0, contact: 0 };
const durs: number[] = [];
let recT = 0, turnT = 0, penT = 0, stallT = 0;
const rows: string[] = [];
const stages = new Map<string, number>();
const reasons = new Map<string, number>();

for (let m = 0; m < matches; m++) {
  seedRng(seedBase + m * 10);
  const d = new Director(gateConfig(DIFF));
  let prevRuck = d.A.stats.rucks + d.B.stats.rucks;
  let prevTurn = d.A.stats.turnovers + d.B.stats.turnovers;
  let prevPen = d.A.stats.penaltiesConceded + d.B.stats.penaltiesConceded;
  let inBd = false;
  let ep = { at: 0, dur: 0, ruck: 0, turn: 0, pen: 0, stall: 0, contact: 0, why: '' };
  let guard = 60 * 700;

  while (!d.over && guard-- > 0) {
    const hasBd = !!d.bd;
    const prevBd: any = d.bd;
    if (hasBd && !inBd) {
      inBd = true;
      ep = { at: d.t, dur: 0, ruck: 0, turn: 0, pen: 0, stall: 0, contact: 0, why: '' };
    }
    d.update(dt, NO_INPUT, new Set());

    if (inBd && d.bd) {
      ep.dur += dt;
      /* Sample the PRE-update state: CONTACT is entered in startBreakdown
       * and advanced to PLACE in the same frame's update, so a post-update
       * sample never sees it (the engine's `CONTACT` stage is one frame). */
      const st = prevBd?.stage ?? d.bd.stage;
      stages.set(st, (stages.get(st) ?? 0) + 1);
      if (st === 'CONTACT') ep.contact++;
      const why = d.bd.resultWhy || d.bd.result;
      if (why) ep.why = why;
    } else if (inBd) {
      // episode ended inside this update — prevBd still carries the exit
      // reason the engine wrote before the object was dropped from d.bd.
      const exit = prevBd?.resultWhy || prevBd?.result || ep.why;
      if (exit && !ep.why) ep.why = exit;
      // episode ended inside this update
      const ruck = d.A.stats.rucks + d.B.stats.rucks, turn = d.A.stats.turnovers + d.B.stats.turnovers;
      const pen = d.A.stats.penaltiesConceded + d.B.stats.penaltiesConceded;
      const isRuck = ruck > prevRuck, isTurn = turn > prevTurn, isPen = pen > prevPen;
      ep.ruck = isRuck ? 1 : 0; ep.turn = isTurn ? 1 : 0; ep.pen = isPen ? 1 : 0;
      ep.stall = /USE IT/.test(ep.why) && !isRuck && !isTurn && !isPen ? 1 : 0;
      /* A stalled ruck ends on the ruck-law clock (2.9-3.2s for the default
       * 3s law) with the USE IT reason written on the same frame the object
       * dies, so the audit sees it only by duration + no stat change. */
      const stallish = ep.stall || (!isRuck && !isTurn && !isPen && ep.dur > 2.8 && !ep.why);
      const kind = isRuck ? 'RECYCLE' : isTurn ? 'TURNOVER' : isPen ? 'PENALTY'
        : stallish ? 'STALL' : /^CONTACT/.test(ep.why || '') ? 'CONTACT-END' : 'MISC';
      const rk = `${kind}|${(ep.why || '-').slice(0, 34)}`;
      reasons.set(rk, (reasons.get(rk) ?? 0) + 1);
      tot.ep++; tot.ruck += ep.ruck; tot.turn += ep.turn; tot.pen += ep.pen;
      tot.stall += ep.stall; tot.contact += ep.contact;
      if (kind === 'MISC') tot.misc++;
      durs.push(ep.dur);
      if (kind === 'RECYCLE') recT += ep.dur;
      else if (kind === 'TURNOVER') turnT += ep.dur;
      else if (kind === 'PENALTY') penT += ep.dur;
      else if (kind === 'STALL') stallT += ep.dur;
      if (rows.length < 14 || kind === 'MISC' || kind === 'STALL') rows.push(`${kind.padEnd(10)} dt=${ep.dur.toFixed(2)} at=${ep.at.toFixed(1)} why=${(ep.why || '-').slice(0, 72)} feed=${(d.feed[0]?.text ?? '-').slice(0, 40)} trips=${d.watchdogTrips}`);
      prevRuck = ruck; prevTurn = turn; prevPen = pen;
      inBd = false;
    }
  }
  const st = d.teams.A.stats;
  const sb = d.teams.B.stats;
  console.log(`match ${m + 1} seed=${seedBase + m * 10} simT=${d.t.toFixed(0)}s: tackles ${st.tackles + sb.tackles} rucks ${st.rucks + sb.rucks} turnovers ${st.turnovers + sb.turnovers} penalties ${st.penaltiesConceded + sb.penaltiesConceded} passes ${st.passes + sb.passes} kicks ${st.kicks + sb.kicks} linebreaks ${st.lineBreaks + sb.lineBreaks}`);
}

const N = tot.ep;
const pct = (n: number) => `${((n / Math.max(1, N)) * 100).toFixed(1)}%`;
const sorted = [...durs].sort((a, b) => a - b);
const q = (f: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))].toFixed(2) : '0';
console.log(`\nepisodes=${N} ruckDurMean=${(recT / Math.max(1, tot.ruck)).toFixed(2)}s turnMean=${(turnT / Math.max(1, tot.turn)).toFixed(2)}s penMean=${(penT / Math.max(1, tot.pen)).toFixed(2)}s stallMean=${(stallT / Math.max(1, tot.stall)).toFixed(2)}s`);
console.log(`outcomes: RECYCLE ${tot.ruck} (${pct(tot.ruck)}) TURNOVER ${tot.turn} (${pct(tot.turn)}) PENALTY ${tot.pen} (${pct(tot.pen)}) STALL ${tot.stall} (${pct(tot.stall)}) MISC ${tot.misc} (${pct(tot.misc)})`);
console.log(`durations p50=${q(0.5)}s p90=${q(0.9)}s p99=${q(0.99)}s max=${q(1)}s`);
console.log(`contact-frames/ep=${(tot.contact / N).toFixed(2)}`);
console.log(`stages: ${[...stages.entries()].map(([k, n]) => `${k}=${n}`).join(' ')}`);
console.log('reasons:');
const kindTot = new Map<string, number>();
for (const [k, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  const kk = k.split('|')[0];
  kindTot.set(kk, (kindTot.get(kk) ?? 0) + n);
  if (/^(TURNOVER|PENALTY)/.test(k)) console.log(`  ${String(n).padStart(3)}  ${k}`);
}
/* The reason map is per-episode: this is the honest breakdown-only ledger
 * (the outcome line above additionally attributes phase-adjacent stat
 * deltas — spilled-pass turnovers and follow-on penalties — to the episode
 * that closed in the same frame). */
console.log(`kindTotals: ${[...kindTot.entries()].map(([k, n]) => `${k}=${n}`).join(' ')}`);
console.log('\nrows:');
for (const r of rows) console.log(' ', r);
