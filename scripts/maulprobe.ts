/** Every maul: where it started, how far it drove, how it ended. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 3 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const rows: string[] = [];
let pens = 0, pensRed = 0, touchKicks = 0;
for (let m = 0; m < 2; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800;
  let mlStart = 0, mlDir = 0, mlFrom = '', lastToLine = 99;
  let scoreA = 0, scoreB = 0;
  while (!d.over && guard-- > 0) {
    if (d.op) lastToLine = d.op.toLine;
    if (d.ml && mlStart === 0) { mlStart = d.ml.z; mlDir = d.ml.dir; mlFrom = d.ml.fromLineout ? 'LO' : 'TACKLE'; }
    const pa = d.pendingPenalty;
    if (pa && d.pendingPenalty !== (undefined)) { /* counted below via stats */ }
    d.update(1 / 60, NO_INPUT, new Set());
    if (!d.ml && mlStart !== 0) {
      const gained = Math.abs(d.ml ? 0 : 0);
      rows.push(`${mlFrom} start=${Math.abs(mlStart).toFixed(0)}m-out dir=${mlDir} -> ${d.A.score + d.B.score > scoreA + scoreB ? 'TRY!' : 'no score'} feed="${(d.feed[0]?.text ?? '').slice(0, 40)}"`);
      scoreA = d.A.score; scoreB = d.B.score;
      mlStart = 0;
    }
    if (d.phase === 'KICK' && d.kk && (d.kk.type === 'GOAL')) { /* goals */ }
  }
}
console.log(`pens conceded A=${0}`);
for (const r of rows.slice(0, 24)) console.log(' ', r);
