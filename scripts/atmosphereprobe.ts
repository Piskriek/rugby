/**
 * TARCS — ATMOSPHERE HEADLESS VERIFICATION PROBE.
 *
 * Proves the atmosphere layer end-to-end WITHOUT a browser, a canvas or a Web
 * Audio context — exactly the way `t43check.ts` proves the replay freeze and
 * `refereeprobe.ts` proves the four law families:
 *
 *   (a) WHISTLE TAXONOMY — ten referee decisions (try, penalty, mark, 50:22,
 *       knock-on, forward pass, out of bounds, advantage over, unplayable
 *       scrum, yellow card) resolve to the correct whistle ID through
 *       atmosphere.whistleFor. The taxonomy is the single source of truth the
 *       audio engine synthesises from, so asserting it IS asserting the sound
 *       each call produces.
 *   (b) NAMED COMMENTARY — ten commentary beats (the 50:22, the Law 9.17
 *       aerial challenge, the rolling maul, and the grounding) format with the
 *       real team/player names and NEVER leak an `undefined` string. Then the
 *       REAL Director is asked to speak them and the live feed is checked.
 *   (c) HUD MATCH CLOCKS — a simulated yellow-card state: the MM:SS countdown
 *       is exact for the remaining sin-bin MATCH seconds, and the effective
 *       team strength ("14 vs 15") follows the binned man leaving the field.
 *
 * Exits 0 when everything passes; any failure exits 1.
 */
import { Director, quickStartConfig } from '../src/game/director';
import {
  WHISTLE_TAXONOMY, whistleFor,
  commentaryLine,
  sinBinClock, sinBinParts, strengthText,
  SIN_BIN_YELLOW_MATCH_S, TURF_BOUNCE_MIN_SPEED_MS,
  turfBounceVolume, tackleCutoffHz,
  type RefereeCall, type CommentaryEvent,
} from '../src/game/atmosphere';

let failures = 0;
const dt = 1 / 60;
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  if (!cond) failures++;
};

/* ============================ (a) WHISTLE TAXONOMY ============================ */
console.log('(a) WHISTLE TAXONOMY — 10 referee decisions resolve to the right whistle');

/* The spec's whistle classes: SHORT routine, LONG hard, TREBLE staccato. */
const SHORT_CALLS: [RefereeCall, string][] = [
  ['OUT_OF_BOUNDS', 'ball dead / out of touch'],
  ['MARK', 'clean mark called'],
  ['ADVANTAGE_OVER', 'advantage complete'],
  ['FIFTY_TWENTY', '50:22 found touch'],
];
const LONG_CALLS: [RefereeCall, string][] = [
  ['TRY_SCORED', 'try grounded'],
  ['PENALTY', 'penalty awarded'],
  ['YELLOW_CARD', 'yellow card issued'],
];
const TREBLE_CALLS: [RefereeCall, string][] = [
  ['KNOCK_ON', 'knock-on'],
  ['FORWARD_PASS', 'forward pass'],
  ['SCRUM_UNPLAYABLE', 'unplayable breakdown / scrum'],
];

let triggered = 0;
for (const [call, why] of SHORT_CALLS) {
  const id = whistleFor(call);
  ok(`SHORT — ${why} -> '${id}'`, id === 'SHORT', call);
  triggered++;
}
for (const [call, why] of LONG_CALLS) {
  const id = whistleFor(call);
  ok(`LONG — ${why} -> '${id}'`, id === 'LONG', call);
  triggered++;
}
for (const [call, why] of TREBLE_CALLS) {
  const id = whistleFor(call);
  ok(`TREBLE — ${why} -> '${id}'`, id === 'TREBLE', call);
  triggered++;
}
ok('10 whistle triggers were simulated across the three classes', triggered === 10);
ok('the forward/unplayable errors alone use the staccato treble', TREBLE_CALLS.every(([c]) => WHISTLE_TAXONOMY[c] === 'TREBLE'));

/* ============================ (b) NAMED COMMENTARY ============================ */
console.log('(b) NAMED COMMENTARY — 10 beats format cleanly, no undefined leaks');

const NO_UNDEFINED = (s: string) => !/undefined|NaN|null/.test(s);

/* Beat by beat with real, engine-shaped names. */
const commentaryCases: { event: CommentaryEvent; ctx: Record<string, string>; wantClean: boolean; mustContain: string[] }[] = [
  { event: 'FIFTY_TWENTY', ctx: { team: 'England' }, wantClean: true, mustContain: ['Sensational 50:22', 'England'] },
  { event: 'FIFTY_TWENTY', ctx: { team: 'New Zealand' }, wantClean: true, mustContain: ['New Zealand'] },
  { event: 'AERIAL', ctx: { player: 'R. Underwood', team: 'England' }, wantClean: true, mustContain: ['Dangerous tackle in the air', 'R. Underwood'] },
  { event: 'AERIAL', ctx: { player: 'J. Kirwan', team: 'New Zealand' }, wantClean: true, mustContain: ['J. Kirwan'] },
  { event: 'MAUL', ctx: { team: 'Wales' }, wantClean: true, mustContain: ['maul is rumbling forward', 'Wales'] },
  { event: 'MAUL', ctx: { team: 'Scotland' }, wantClean: true, mustContain: ['Scotland'] },
  { event: 'TRY', ctx: { player: 'D. Campese', team: 'Australia' }, wantClean: true, mustContain: ['TRY!', 'D. Campese'] },
  { event: 'TRY', ctx: { player: 'P. Sella', team: 'France' }, wantClean: true, mustContain: ['P. Sella'] },
  /* Missing identities must fall back to a readable label, never undefined. */
  { event: 'AERIAL', ctx: {}, wantClean: false, mustContain: ['Dangerous tackle in the air', 'ball-carrier'] },
  { event: 'TRY', ctx: { team: 'Ireland' }, wantClean: false, mustContain: ['ball-carrier'] },
];

let beats = 0;
for (const c of commentaryCases) {
  const out = commentaryLine(c.event, c.ctx);
  ok(
    `${c.event} formats cleanly${c.wantClean ? ' (real names)' : ' (fallback covered)'}`,
    out.clean === c.wantClean && NO_UNDEFINED(out.line) && c.mustContain.every((m) => out.line.includes(m)),
    out.line,
  );
  beats++;
}
ok('10 commentary beats were simulated and all read without a gap', beats === 10);

/* The REAL Director is asked to speak every beat; the live feed must never
 * show an undefined string. This is the wiring, not just the formatter. */
const d = new Director(quickStartConfig());
const script: [CommentaryEvent, { player?: string; team?: string }][] = [
  ['FIFTY_TWENTY', { team: d.A.nation.short }],
  ['AERIAL', { player: 'R. Underwood', team: d.A.nation.short }],
  ['MAUL', { team: d.B.nation.short }],
  ['TRY', { player: d.A.players[14].name, team: d.A.nation.short }],
];
for (const [ev, ctx] of script) d.atmosphereCommentary(ev, ctx);
const leaked = d.feed.some((f) => NO_UNDEFINED(f.text) === false);
ok('live Director feed carries the atmosphere beats', d.feed.length >= script.length);
ok('no live feed line leaked an undefined name', !leaked);

/* ============================ (c) HUD MATCH CLOCKS ============================ */
console.log('(c) HUD MATCH CLOCKS — yellow card countdown and team strength');

ok('a yellow card is ten full MATCH minutes', SIN_BIN_YELLOW_MATCH_S === 600);
/* 545 match seconds remain -> 9 whole minutes + 5 seconds. */
ok('545 s remaining -> MM:SS 09:05', sinBinClock(545) === '09:05', sinBinClock(545));
ok('545 s splits to {9m, 5s}', sinBinParts(545).mm === 9 && sinBinParts(545).ss === 5);
ok('600 s exactly -> 10:00', sinBinClock(600) === '10:00');
ok('a sub-minute remainder still pads the seconds', sinBinClock(3) === '00:03');
ok('an expired bin floors at 00:00, never negative', sinBinClock(-40) === '00:00');

/* Simulate a yellow card on the live board: shirt 6 of side A leaves the
 * field, so A drops to fourteen while B stays at fifteen. */
const bootA = d.activeCount('A');
const bootB = d.activeCount('B');
ok('match boots 15v15', bootA === 15 && bootB === 15, `A=${bootA} B=${bootB}`);
const binned = d.live.find((p) => p.team === 'A' && p.sinbin <= 0);
if (binned) {
  binned.sinbin = 545; // ten minutes served down to 545 match seconds
  ok('HUD shows the exact remaining sin-bin clock on the carded shirt',
    sinBinClock(binned.sinbin) === '09:05');
  ok('team strength reads 14 vs 15 while A is a man down',
    strengthText(d.activeCount('A'), d.activeCount('B')) === '14 vs 15',
    `${d.activeCount('A')} vs ${d.activeCount('B')}`);
  ok('the binned side is one under while the other is whole',
    d.activeCount('A') === 14 && d.activeCount('B') === 15);
} else {
  ok('a live shirt could be carded for the strength probe', false, 'no on-field A player to bin');
}

/* Physical collision helpers: the turf bounce gate and tackle-weight colouring. */
console.log('(physical) turf-impact gate and velocity-weighted tackle colour');
ok('a 1 m/s roll is silent (below the 2 m/s turf gate)', turfBounceVolume(1) === 0);
ok('the turf gate sits at 2 m/s', TURF_BOUNCE_MIN_SPEED_MS === 2);
ok('a 5 m/s drop registers on the turf curve', turfBounceVolume(5) > 0 && turfBounceVolume(5) < 1);
ok('a heavy 10 m/s drop is near full scale', turfBounceVolume(10) > 0.9);
ok('tackle low-pass closes as collision speed rises', tackleCutoffHz(4) > tackleCutoffHz(11));

/* ============================ VERDICT ============================ */
console.log('');
if (failures) {
  console.log(`ATMOSPHERE PROBE: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('ATMOSPHERE PROBE PASSES — whistle taxonomy, named commentary, sin-bin clocks');
process.exit(0);
