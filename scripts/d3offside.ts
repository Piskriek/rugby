/**
 * D-3 — T-71 offside loitering / retreat. Read-only.
 *
 * "Players do not retreat with intent" must become a number. For every frame a
 * player is offside (penetration > 0 past a live line), measure whether he is
 * closing on the line, holding station, or drifting further offside.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { liveOffsideLines, penetrationOf, insideCorridor } from '../src/game/engine/offside';

const dt = 1 / 60;
const diff = Number(process.argv[2] ?? 3);
const secs = Number(process.argv[3] ?? 180);

interface Ep { who: string; kind: string; frames: number; startPen: number; endPen: number; peakPen: number; retreatFrames: number; advanceFrames: number; holdFrames: number; }
const open = new Map<string, { kind: string; frames: number; startPen: number; peak: number; lastPen: number; ret: number; adv: number; hold: number }>();
const done: Ep[] = [];

seedRng(1);
const d = new Director(gateConfig(diff));
for (let i = 0; i < secs * 60 && !d.over; i++) {
  d.update(dt, NO_INPUT, new Set());
  const lines = liveOffsideLines(d);
  const seen = new Set<string>();
  for (const line of lines) {
    for (const p of d.live) {
      if (!line.offenders.includes(p.team as 'A' | 'B')) continue;
      // a man who FORMS the line cannot be offside against it
      if (line.participants?.has(`${p.team}:${p.num}`)) continue;
      const tl = line.lineFor(p.team as 'A' | 'B');
      if (!tl) continue;
      if (!insideCorridor(p, line)) continue;
      const pen = penetrationOf(p, tl);
      if (pen <= 0) continue;
      /* D-3 — exclude the men the retreat fix deliberately does not own: the
       * ball carrier (he cannot be "loitering offside" — he IS the ball) and a
       * man bound into the contest. Measured, the 8.83 s "episode" in the
       * first pass was the CARRIER sitting 0.15 m over an OPEN line. Counting
       * him made the tail look like a loitering defect when it is not one. */
      if (p.carrier || p.bound || p.sinbin > 0) continue;
      const key = `${p.team}${p.num}`;
      seen.add(key);
      const st = open.get(key);
      if (!st) {
        open.set(key, { kind: line.kind, frames: 1, startPen: pen, peak: pen, lastPen: pen, ret: 0, adv: 0, hold: 0 });
      } else {
        st.frames++;
        const dp = pen - st.lastPen;
        if (dp < -0.005) st.ret++; else if (dp > 0.005) st.adv++; else st.hold++;
        st.peak = Math.max(st.peak, pen);
        st.lastPen = pen;
      }
    }
  }
  for (const [k, st] of [...open]) {
    if (!seen.has(k)) {
      done.push({ who: k, kind: st.kind, frames: st.frames, startPen: st.startPen, endPen: st.lastPen, peakPen: st.peak, retreatFrames: st.ret, advanceFrames: st.adv, holdFrames: st.hold });
      open.delete(k);
    }
  }
}
for (const [k, st] of open) done.push({ who: k, kind: st.kind, frames: st.frames, startPen: st.startPen, endPen: st.lastPen, peakPen: st.peak, retreatFrames: st.ret, advanceFrames: st.adv, holdFrames: st.hold });

console.log('=========== D-3  OFFSIDE RETREAT  (diff %s, %ss) ===========', diff, secs);
console.log('offside episodes: %s', done.length);
const long = done.filter((e) => e.frames >= 15);   // >= 0.25 s, ignore brush-bys
console.log('episodes lasting >= 0.25 s: %s', long.length);
if (!long.length) { console.log('nothing to analyse'); }
else {
  const tot = long.reduce((a, e) => a + e.frames, 0);
  const ret = long.reduce((a, e) => a + e.retreatFrames, 0);
  const adv = long.reduce((a, e) => a + e.advanceFrames, 0);
  const hold = long.reduce((a, e) => a + e.holdFrames, 0);
  console.log('\n--- what does an offside player DO? (frame share) ---');
  console.log('  retreating toward the line : %s%%', (ret / tot * 100).toFixed(1));
  console.log('  drifting further offside   : %s%%', (adv / tot * 100).toFixed(1));
  console.log('  holding station (loitering): %s%%', (hold / tot * 100).toFixed(1));

  const zeroRetreat = long.filter((e) => e.retreatFrames === 0).length;
  const netWorse = long.filter((e) => e.endPen >= e.startPen).length;
  console.log('\n--- intent ---');
  console.log('  episodes with ZERO retreating frames : %s / %s (%s%%)', zeroRetreat, long.length, (zeroRetreat / long.length * 100).toFixed(1));
  console.log('  episodes ending no better than they started: %s / %s (%s%%)', netWorse, long.length, (netWorse / long.length * 100).toFixed(1));

  const dur = long.map((e) => e.frames / 60).sort((a, b) => a - b);
  const q = (p: number) => dur[Math.min(dur.length - 1, Math.floor(p / 100 * dur.length))];
  console.log('\n--- how long do they linger? (seconds) ---');
  console.log('  p50 %s  p90 %s  max %s', q(50).toFixed(2), q(90).toFixed(2), q(100).toFixed(2));
  const pk = long.map((e) => e.peakPen).sort((a, b) => a - b);
  console.log('  peak penetration p50 %s  max %s m', pk[Math.floor(pk.length / 2)].toFixed(2), pk[pk.length - 1].toFixed(2));

  const byKind = new Map<string, number>();
  for (const e of long) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  console.log('\n--- by line kind ---  %s', [...byKind].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
}
