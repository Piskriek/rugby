/** Quick numeric sanity of the fall solver — printed before any bake. */
import { solveFall, FALL_N, CH } from '../src/physics/falls';

function stat(desc: ReturnType<typeof solveFall>, label: string) {
  const rows = Array.from({ length: CH_COUNT_SAFE }).map(() => [Infinity, -Infinity]);
  const ends: number[] = [];
  for (let s = 0; s < FALL_N; s++) {
    for (let c = 0; c < rows.length; c++) {
      const v = desc[c * FALL_N + s];
      if (v < rows[c][0]) rows[c][0] = v;
      if (v > rows[c][1]) rows[c][1] = v;
    }
  }
  for (let c = 0; c < rows.length; c++) ends.push(desc[c * FALL_N + FALL_N - 1]);
  console.log(label);
  console.log('  pitch    range', rows[CH.pitch][0].toFixed(2), '..', rows[CH.pitch][1].toFixed(2), ' end', ends[CH.pitch].toFixed(2));
  console.log('  twistZ   range', rows[CH.twistZ][0].toFixed(2), '..', rows[CH.twistZ][1].toFixed(2), ' end', ends[CH.twistZ].toFixed(2));
  console.log('  arms R flex/ab/elb end', ends[CH.armRflex].toFixed(2), ends[CH.armRab].toFixed(2), ends[CH.armRelbow].toFixed(2));
  console.log('  legs R flex/ab/knee end', ends[CH.legRflex].toFixed(2), ends[CH.legRab].toFixed(2), ends[CH.legRknee].toFixed(2));
  console.log('  headX/headY end', ends[CH.headX].toFixed(2), ends[CH.headY].toFixed(2));
}
const CH_COUNT_SAFE = 17;

console.log('-- slow low tackle (F, 2.5 m/s, h0.35)');
stat(solveFall({ kind: 'FALL', speed: 2.5, hitH: 0.35, massR: 1, dir: 'F' }), '');
console.log('-- big hit low (F, 10 m/s, h0.35)');
stat(solveFall({ kind: 'FALL', speed: 10, hitH: 0.35, massR: 1.2, dir: 'F' }), '');
console.log('-- shoulder high (F, 10 m/s, h0.85)');
stat(solveFall({ kind: 'FALL', speed: 10, hitH: 0.85, massR: 1.2, dir: 'F' }), '');
console.log('-- backward (B, 7.5 m/s, h0.6)');
stat(solveFall({ kind: 'FALL', speed: 7.5, hitH: 0.6, massR: 1, dir: 'B' }), '');
console.log('-- lateral right (S, 7.5 m/s, h0.6)');
stat(solveFall({ kind: 'FALL', speed: 7.5, hitH: 0.6, massR: 1, dir: 'S' }), '');
console.log('-- tackler roll (ROLL, 5 m/s)');
stat(solveFall({ kind: 'ROLL', speed: 5, hitH: 0.6, massR: 1, dir: 'F' }), '');
