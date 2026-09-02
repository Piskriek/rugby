/** Red-zone anatomy v2: possession-scoped, stats-delta classification. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 3 >>> 0 || 1;
const dt = 1 / 60;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const deaths: Map<string, number> = new Map();
let entries = 0, tries = 0, deepest = 0, withMaul = 0, withLineout = 0;
for (let m = 0; m < 4; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800;
  let inRed = false, team: 'A' | 'B' = 'A', best = 0, sawMaul = false, sawLO = false;
  let snap = { triesA: 0, triesB: 0, penA: 0, penB: 0, toA: 0, toB: 0 };
  const end = (why: string) => {
    deaths.set(why, (deaths.get(why) ?? 0) + 1);
    if (sawMaul) withMaul++;
    if (sawLO) withLineout++;
    inRed = false;
  };
  while (!d.over && guard-- > 0) {
    const mlWas = !!d.ml, loWas = !!d.lo;
    d.update(dt, NO_INPUT, new Set());
    if (d.op) {
      const red = d.op.toLine < 24;
      if (red && !inRed) { inRed = true; team = d.op.attacking; best = 0; sawMaul = false; sawLO = false;
        snap = { triesA: d.events.filter((e) => e.kind === 'TRY').length, triesB: 0, penA: d.A.stats.penaltiesConceded, penB: d.B.stats.penaltiesConceded, toA: d.A.stats.turnovers, toB: d.B.stats.turnovers };
        entries++; }
      if (inRed && d.op.attacking === team) { best = Math.max(best, 24 - Math.round(d.op.toLine)); }
      if (inRed && (!red || d.op.attacking !== team)) {
        deepest = Math.max(deepest, best);
        const tryScored = (d.events.filter((e) => e.kind === 'TRY').length - snap.triesA) > 0;
        const penAgainst = (team === 'A' ? d.A.stats.penaltiesConceded - snap.penA : d.B.stats.penaltiesConceded - snap.penB);
        const lostBall = (team === 'A' ? d.A.stats.turnovers - snap.toA : d.B.stats.turnovers - snap.toB);
        if (tryScored) { tries++; end('TRY'); }
        else if (penAgainst) end('PENALTY CONCEDED');
        else if (lostBall) end('TURNOVER');
        else if (!d.op || d.op.attacking !== team) end('POSSESSION LOST (scrum/lineout vs)');
        else end('CAME OUT OF THE 22 (kick or bounce)');
      }
    } else if (inRed) {
      // phase ended (set piece forming) — track the pieces
      if (d.ml) sawMaul = true;
      if (d.lo && !loWas) sawLO = true;
      // if the set piece belongs to the OTHER side, the entry is dead
      const poss = d.possession;
      if (poss !== team && (d.ml || d.scrim)) { deepest = Math.max(deepest, best); end('SET PIECE TO THE DEFENCE'); }
    }
  }
}
console.log(`red-zone: ${entries} entries, tries ${tries} (${((tries / Math.max(1, entries)) * 100).toFixed(0)}%)`);
console.log('deaths:', [...deaths.entries()].sort((a, b) => b[1] - a[1]));
console.log(`with a maul ${withMaul}, with a lineout ${withLineout}, deepest metres into the 22 ${deepest}`);
