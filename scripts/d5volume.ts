/**
 * D-5 — SPEC_04 volume tuning. Read-only, analytic.
 *
 * src/game/audio.ts is pure WebAudio and cannot be rendered headlessly, but
 * every gain is a literal, so the mix can be computed exactly. This reports
 * the peak linear gain each source contributes at the master node, converts to
 * dBFS, and flags where sources collide.
 */
const MASTER = 0.9;
const db = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '-inf');

console.log('=========== D-5  AUDIO MIX  (analytic) ===========');
console.log('master gain %s (%s dBFS)\n', MASTER, f2(db(MASTER)));

/* ---- crowd bed ---- */
console.log('--- CROWD BED (continuous) ---');
console.log('  swell target = (0.05 + |momentum|*0.055 + in22*0.08 + spike) * gate');
console.log('  bedGain      = swell * (0.55 + crowdRatio*0.55)');
console.log('  level gate: OFF=0, LOW=0.45, FULL=1\n');
console.log('  scenario                                   swell   bedGain   at master   dBFS');
const bed = (mom: number, in22: boolean, spike: number, crowd: number, gate: number) => {
  const swell = (0.05 + Math.abs(mom) * 0.055 + (in22 ? 0.08 : 0) + spike) * gate;
  const bg = swell * (0.55 + crowd * 0.55);
  return { swell, bg, at: bg * MASTER };
};
const rows: [string, number, boolean, number, number, number][] = [
  ['idle, neutral, no travelling support', 0, false, 0, 0, 1],
  ['idle, neutral, full support', 0, false, 0, 1, 1],
  ['big momentum, in the 22, full support', 1, true, 0, 1, 1],
  ['TRY spike (0.34), in 22, full support', 1, true, 0.34, 1, 1],
  ['TRY spike, LOW level gate', 1, true, 0.34, 1, 0.45],
];
for (const [label, m, i22, sp, cr, g] of rows) {
  const r = bed(m, i22, sp, cr, g);
  console.log('  %s %s  %s  %s  %s', label.padEnd(41),
    r.swell.toFixed(3).padStart(6), r.bg.toFixed(3).padStart(8), r.at.toFixed(3).padStart(10), f2(db(r.at)).padStart(7));
}

/* ---- one-shots ---- */
console.log('\n--- ONE-SHOTS (peak) ---');
console.log('  source            force   peak gain   at master   dBFS');
const impact = (f: number) => 0.22 * f + 0.03;
const shots: [string, number, number][] = [
  ['TACKLE (force 0)', 0, impact(0.35)],
  ['TACKLE (force 1)', 1, impact(1.0)],
  ['KICK', 0.4, impact(0.4)],
  ['WHISTLE blast', 1, 0.085],
];
for (const [label, f, g] of shots) {
  console.log('  %s %s  %s  %s  %s', label.padEnd(17), String(f).padStart(5),
    g.toFixed(4).padStart(10), (g * MASTER).toFixed(4).padStart(10), f2(db(g * MASTER)).padStart(7));
}
console.log('\n  NOTE: the whistle sums TWO detuned oscillators through one gain');
console.log('  (og 1.0 and 0.5), so its true peak is up to 1.5x the envelope:');
console.log('  %s at master = %s dBFS', (0.085 * 1.5 * MASTER).toFixed(4), f2(db(0.085 * 1.5 * MASTER)));
console.log('  DOUBLE fires two blasts 0.24 s apart — no overlap (dur 0.16).');

/* ---- collisions ---- */
console.log('\n--- WORST-CASE SUM (a try: bed spike + whistle x2) ---');
const worst = bed(1, true, 0.34, 1, 1).at + 0.085 * 1.5 * MASTER;
console.log('  bed %s + whistle %s = %s  (%s dBFS)  clipping: %s',
  bed(1, true, 0.34, 1, 1).at.toFixed(3), (0.085 * 1.5 * MASTER).toFixed(3),
  worst.toFixed(3), f2(db(worst)), worst > 1 ? 'YES' : 'no');
const worst2 = worst + impact(1.0) * MASTER;
console.log('  + a max-force TACKLE in the same instant = %s  (%s dBFS)  clipping: %s',
  worst2.toFixed(3), f2(db(worst2)), worst2 > 1 ? 'YES' : 'no');

/* ---- dynamic range ---- */
console.log('\n--- DYNAMIC RANGE ---');
const quiet = bed(0, false, 0, 0, 1).at;
const loud = bed(1, true, 0.34, 1, 1).at;
console.log('  quietest bed %s dBFS -> loudest bed %s dBFS = %s dB of range',
  f2(db(quiet)), f2(db(loud)), (db(loud) - db(quiet)).toFixed(1));
console.log('  loudest one-shot (tackle f=1) is %s dB above the quiet bed',
  (db(impact(1) * MASTER) - db(quiet)).toFixed(1));
console.log('\n  There is NO limiter or compressor in the chain — every node');
console.log('  connects straight to master. Sums above 1.0 hard-clip.');
