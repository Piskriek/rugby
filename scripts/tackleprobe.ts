/**
 * TACKLE PROBE — measures how often the defence actually brings the carrier
 * to ground: latch starts, dive launches, dive misses (face-plants with no
 * hands on), slipped tackles, line breaks and completed tackles.
 *
 * Usage: npx vite-node scripts/tackleprobe.ts [seconds]
 */
import { Director, NO_INPUT, MatchConfig } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seconds = Number(process.argv[2] ?? 240);
const seeds = [1, 7, 13, 21];
const diffs = [3];

interface Totals {
  latches: number; diveStarts: number; diveMisses: number;
  slips: number; tackles: number; breaks: number; tries: number;
}

for (const diff of diffs) {
  const tot: Totals = { latches: 0, diveStarts: 0, diveMisses: 0, slips: 0, tackles: 0, breaks: 0, tries: 0 };
  for (const seed of seeds) {
    seedRng(seed);
    const base = gateConfig(diff);
    /* CPU vs CPU: both sides run the same defence code the user faces. */
    const cfg: MatchConfig = { ...base, cpuA: true, cpuB: true };
    const d = new Director(cfg);

    const wasDiving = new Set<string>();
    const prevRecover = new Map<string, number>();
    let prevLatch = false;
    let prevMissed = 0;
    let prevBreaks = -1;

    const frames = Math.ceil(seconds * 60);
    for (let i = 0; i < frames && !d.over; i++) {
      d.update(1 / 60, NO_INPUT, new Set());

      const latchedNow = !!d.op?.latch;
      if (latchedNow && !prevLatch) tot.latches++;
      prevLatch = latchedNow;

      const divingNow = new Set<string>();
      for (const p of d.live) {
        const id = `${p.team}${p.num}`;
        if ((p.diveT ?? 0) > 0) {
          divingNow.add(id);
          if (!wasDiving.has(id)) tot.diveStarts++;
        }
        const rec = p.recoverT ?? 0;
        const was = prevRecover.get(id) ?? 0;
        /* a fresh get-up lock on a man who was airborne last frame = dive miss */
        if (rec > 0 && was <= 0 && wasDiving.has(id)) tot.diveMisses++;
        prevRecover.set(id, rec);
      }
      wasDiving.clear();
      for (const id of divingNow) wasDiving.add(id);

      const missed = d.teams.A.stats.missed + d.teams.B.stats.missed;
      tot.slips += Math.max(0, missed - prevMissed);
      prevMissed = missed;

      const br = (d.teams.A.stats.lineBreaks ?? 0) + (d.teams.B.stats.lineBreaks ?? 0);
      if (prevBreaks >= 0) tot.breaks += Math.max(0, br - prevBreaks);
      prevBreaks = br;
    }
    tot.tackles += d.teams.A.stats.tackles + d.teams.B.stats.tackles;
    tot.tries += d.teams.A.score + d.teams.B.score;
    console.log(`  seed ${seed}: ${d.teams.A.score}-${d.teams.B.score}  tackles ${d.teams.A.stats.tackles + d.teams.B.stats.tackles} missed ${d.teams.A.stats.missed + d.teams.B.stats.missed} breaks ${(d.teams.A.stats.lineBreaks ?? 0) + (d.teams.B.stats.lineBreaks ?? 0)} phases ${d.phaseCount ?? '?'}`);
  }
  console.log(`\n=== diff ${diff}, ${seeds.length} seeds x ${seconds}s ===`);
  console.log(`  latches ${tot.latches}  diveStarts ${tot.diveStarts}  diveMisses ${tot.diveMisses}  slips ${tot.slips}`);
  console.log(`  tacklesMade ${tot.tackles}  breaks ${tot.breaks}  tries ${tot.tries}`);
}
