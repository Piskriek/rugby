/**
 * SIMCHECK — the simulation's proving ground.
 *
 * Runs full AI-v-AI matches (both teams CPU, exactly like the corpus's own
 * headless trace runs) from fixed seeds and gates the result against real
 * rugby numbers: phase counts, set-piece frequency, scorelines, law events.
 * The match engine is pure logic, so this runs hundreds of times faster than
 * real time — a whole 80-minute match in a second or two.
 *
 * Usage:  npx vite-node tools/simcheck.ts [seeds...]
 */
import { Match } from '../src/engine/match';
import type { MatchSetup } from '../src/engine/types';
import type { MatchViewState, EventKind } from '../src/engine/types';
import { WEATHER_ROLL, WEATHER_LABEL } from '../src/engine/tuning';

const NATIONS = ['ENG', 'NZL', 'AUS', 'FRA', 'SCO', 'WAL', 'IRE', 'ARG', 'RSA', 'JPN', 'SAM', 'FIJ', 'ITA', 'CAN', 'USA', 'ROM'];

// Benchmarks are the corpus's own (src/game/statsAudit.ts BENCHMARKS) —
// professional Test / top-flight ranges, PER MATCH unless the label says
// per team. simcheck keeps a few structural gates of its own as well.
const gates: Array<{ id: string; test: (r: Report) => boolean; note: string }> = [
  { id: 'COMPLETES', test: (r) => r.over, note: 'match reaches full time' },
  { id: 'NO_STALL', test: (r) => r.stalls === 0, note: 'no phase stuck > watchdog' },
  { id: 'TRIES 1-6/TEAM', test: (r) => r.triesA >= 1 && r.triesA <= 6 && r.triesB >= 1 && r.triesB <= 6, note: '1-6 tries per team (~3)' },
  { id: 'POINTS 12-34/TEAM', test: (r) => r.ptsA >= 12 && r.ptsA <= 34 && r.ptsB >= 12 && r.ptsB <= 34, note: '12-34 points per team (~25-20)' },
  { id: 'TACKLES 90-220/TEAM', test: (r) => r.tacklesA >= 90 && r.tacklesA <= 220 && r.tacklesB >= 90 && r.tacklesB <= 220, note: '90-220 tackles per team' },
  { id: 'RUCKS 120-200', test: (r) => r.rucks >= 120 && r.rucks <= 200, note: '~150-170 rucks per match' },
  { id: 'SCRUMS 14-20', test: (r) => r.scrums >= 14 && r.scrums <= 20, note: 'distinct awarded scrum occurrences' },
  { id: 'LINEOUTS 20-28', test: (r) => r.lineouts >= 20 && r.lineouts <= 28, note: 'distinct awarded lineout occurrences' },
  { id: 'PENS 14-28', test: (r) => r.pens >= 14 && r.pens <= 28, note: 'penalties per match (~18-22)' },
  { id: 'RESTARTS 8-28', test: (r) => r.restarts >= 8 && r.restarts <= 28, note: 'knock-ons/fwd passes/turnover scrums' },
  { id: 'PASSES 180-340', test: (r) => r.passes >= 180 && r.passes <= 340, note: 'passes per match (~250)' },
  { id: 'KICKS 30-70', test: (r) => r.kicks >= 30 && r.kicks <= 70, note: 'kicks from hand (~45-55)' },
  { id: 'METRES 250-800/TEAM', test: (r) => r.metresA >= 250 && r.metresA <= 800 && r.metresB >= 250 && r.metresB <= 800, note: 'metres carried per team (~400-600)' },
  { id: 'LINEBREAKS 2-16/TEAM', test: (r) => r.lbA >= 2 && r.lbA <= 16 && r.lbB >= 2 && r.lbB <= 16, note: 'line breaks per team (~8)' },
  { id: 'TURNOVERS 10-32', test: (r) => r.turnovers >= 10 && r.turnovers <= 32, note: 'turnovers incl. breakdown/errors (~18-22)' },
  { id: 'POSS 40-60%', test: (r) => Math.max(r.possA, r.possB) <= 60, note: 'possession split near 50/50' },
  { id: 'OFFLOADS 4-30', test: (r) => r.offloads >= 4 && r.offloads <= 30, note: 'offloads per match (~12)' },
  { id: 'WALL < 5m', test: (r) => r.wallMin < 5, note: 'whole match sims in seconds' },
];

interface Report {
  seed: number; over: boolean; stalls: number;
  tries: number; points: number; scrums: number; lineouts: number; rucks: number;
  tackles: number; tacklesA: number; tacklesB: number;
  pens: number; restarts: number; passes: number; kicks: number; phases: number;
  triesA: number; triesB: number; ptsA: number; ptsB: number;
  metresA: number; metresB: number; lbA: number; lbB: number;
  turnovers: number; offloads: number; possA: number; possB: number;
  wallMin: number; box: string; log: string[]; counts: Record<string, number>;
  home: string; away: string; homeScore: number; awayScore: number;
  ratingA: string; ratingB: string; firstHalf: string; secondHalf: string;
}

function reportFor(seed: number, a: string, b: string): Report {
  const setup: MatchSetup = {
    a: { id: a, kitIdx: 0, human: false },
    b: { id: b, kitIdx: 0, human: false },
    difficulty: 3,
    halfMinutes: 40,
    weather: WEATHER_ROLL((seed * 2654435761) % 100 / 100),
    seed,
  };
  const m = new Match(setup);
  const t0 = performance.now();
  const log: string[] = [];
  let stalls = 0;
  let guard = 0;
  const MAX_GUARD = 1_200_000;
  const STALL_FRAMES = 480; // 24 sim seconds without ANY state change

  // Live event tally from the engine's UNTRIMMED ledger (m.events is trimmed
  // to 300 and several events can push inside one update tick, so neither the
  // final list nor the tail reference captures the full match).
  const ev = new Map<string, number>();
  const evTeam = new Map<string, Map<string, number>>();
  let lastSeq = 0;
  const tally = (k: EventKind, team: string | null) => {
    ev.set(k, (ev.get(k) ?? 0) + 1);
    if (team) {
      let tm = evTeam.get(team);
      if (!tm) { tm = new Map(); evTeam.set(team, tm); }
      tm.set(k, (tm.get(k) ?? 0) + 1);
    }
  };
  const drainLedger = () => {
    while (lastSeq < m.ledger.length) {
      const e = m.ledger[lastSeq++];
      if (e) tally(e.kind, e.team);
    }
  };
  drainLedger();

  // Watchdog key: any change (kind, phase label/sub, ball state/position,
  // carrier) means the match is alive. Only a *frozen* state stalls.
  let prevKey = '';
  let sameFrames = 0;
  while (!m.over && guard++ < MAX_GUARD) {
    m.update(0.05);
    drainLedger();
    const s0 = m.snapshot();
    const key = `${m.kind}|${m.phase.label}|${m.phase.sub}|${s0.ball.state}|${m.carrierIdx}|${Math.round(s0.ball.x)}|${Math.round(s0.ball.y)}`;
    sameFrames = key === prevKey ? sameFrames + 1 : 0;
    prevKey = key;
    if (sameFrames > STALL_FRAMES) {
      stalls++;
      log.push(`STALL@${m.kind} t=${m.t.toFixed(0)}s "${m.phase.label}" sub="${m.phase.sub}" ball=${s0.ball.state}@${s0.ball.x.toFixed(0)},${s0.ball.y.toFixed(0)} score=${s0.a.score}-${s0.b.score}`);
      break;
    }
  }

  const wallMin = (performance.now() - t0) / 60000;
  const s = m.snapshot();
  const count = (k: EventKind) => ev.get(k) ?? 0;
  const countTeam = (k: EventKind, t: string) => evTeam.get(t)?.get(k) ?? 0;
  const countA = (k: EventKind) => countTeam(k, 'A');
  const countB = (k: EventKind) => countTeam(k, 'B');

  const tries = count('TRY');
  const pens = count('PENALTY');
  const scrums = m.seen.scrums;
  const lineouts = m.seen.lineouts;
  const rucks = m.seen.rucks;
  const tackles = s.a.st.tackles + s.b.st.tackles;
  const tacklesA = s.a.st.tackles; const tacklesB = s.b.st.tackles;
  const points = s.a.score + s.b.score;
  const phases = s.a.st.phases + s.b.st.phases;
  // open-play kicks: launched KICK + GRUBBER events (restarts carry their own
  // kinds; goal kicks carry CONVERSION/PENALTY_GOAL) — passes from team stats
  const kicks = count('KICK') + count('GRUBBER');
  const passes = s.a.st.passes + s.b.st.passes;
  const ratingA = mvpName(m, 'A');
  const ratingB = mvpName(m, 'B');
  const possA = Math.round((s.a.st.possession / Math.max(1, s.a.st.possession + s.b.st.possession)) * 100);

  const box = buildBox(s);
  const report: Report = {
    seed, over: m.over, stalls,
    tries, points, scrums, lineouts, rucks, tackles, tacklesA, tacklesB, pens,
    restarts: m.seen.knockOns + m.seen.fwdPasses,
    passes, kicks,
    triesA: s.a.tries, triesB: s.b.tries, ptsA: s.a.score, ptsB: s.b.score,
    metresA: s.a.st.metres, metresB: s.b.st.metres,
    lbA: s.a.st.lineBreaks, lbB: s.b.st.lineBreaks,
    turnovers: s.a.st.turnovers + s.b.st.turnovers,
    offloads: s.a.st.offloads + s.b.st.offloads,
    possA, possB: 100 - possA,
    phases, wallMin, box, log,
    counts: {
      TRY: tries, CONV: count('CONVERSION'), PEN_GOAL: count('PENALTY_GOAL'), PEN_MISS: count('PENALTY_MISS'),
      PENALTY: pens, SCRUM: count('SCRUM'), LINEOUT: count('LINEOUT'), RUCK_EV: count('RUCK'),
      TACKLE: count('TACKLE'), TURNOVER: count('TURNOVER'), KNOCK_ON: count('KNOCK_ON'), FWD_PASS: count('FWD_PASS'),
      TOUCH: count('TOUCH'), KICK: count('KICK'), GRUBBER: count('GRUBBER'), OFFLOAD: count('OFFLOAD'),
      KICKOFF: count('KICKOFF'), DROP22: count('RESTART_22'),
      A_PENS: countA('PENALTY'), B_PENS: countB('PENALTY'),
    },
    home: s.a.short, away: s.b.short, homeScore: s.a.score, awayScore: s.b.score,
    ratingA, ratingB, firstHalf: '', secondHalf: '',
  };
  return report;
}

function mvpName(m: Match, team: 'A' | 'B'): string {
  const live = team === 'A' ? m.a : m.b;
  let best = live.players[0];
  for (const p of live.players) if (p.rating > best.rating) best = p;
  return `${best.num} ${best.name.split(' ').slice(-1)[0]} (${best.rating.toFixed(1)})`;
}

function buildBox(s: MatchViewState): string {
  const row = (t: 'A' | 'B') => {
    const L = t === 'A' ? s.a : s.b;
    const O = t === 'A' ? s.b : s.a;
    const possPct = Math.round((L.st.possession / Math.max(1, L.st.possession + O.st.possession)) * 100);
    const terrPct = Math.round((L.st.territory / Math.max(1, L.st.territory + O.st.territory)) * 100);
    return [
      `${L.short}`, `${L.score}`, `${L.tries}`, `${L.conv}`, `${L.pens}`, `${L.drops}`,
      `${L.st.tackles}/${L.st.tacklesMissed}`, `${L.st.lineBreaks}`, `${L.st.turnovers}`,
      `${L.st.passes}`, `${L.st.kicks}`, `${L.st.scrumsWon}`, `${L.st.lineoutsWon}`,
      `${possPct}%`, `${terrPct}%`,
    ];
  };
  const head = ['TEAM', 'PTS', 'T', 'C', 'P', 'DG', 'TACK/M', 'LB', 'TO', 'PASS', 'KICK', 'SC-W', 'LO-W', 'POSS', 'TERR'];
  const [a, b] = [row('A'), row('B')];
  const lines: string[] = [];
  for (let i = 0; i < head.length; i++) {
    lines.push(
      `${head[i].padStart(6)} | ${a[i].padStart(5)} | ${b[i].padStart(5)}`,
    );
  }
  return lines.join('\n');
}

function main() {
  const seeds = (process.argv.slice(2).length ? process.argv.slice(2) : ['1', '2', '3', '4', '5']).map(Number);
  const failures: string[] = [];
  const all: Report[] = [];
  for (const seed of seeds) {
    const a = NATIONS[seed % NATIONS.length];
    const b = NATIONS[(seed * 7 + 3) % NATIONS.length];
    const r = reportFor(seed, a, b);
    all.push(r);
    console.log(`\n═══ SEED ${seed} — ${r.home} ${r.homeScore} v ${r.awayScore} ${r.away} (${WEATHER_LABEL[(r as unknown as { weather: string }).weather as never] || ''}) ═══`);
    console.log(`over=${r.over} stalls=${r.stalls} wall=${r.wallMin.toFixed(1)}m`);
    console.log(`tries=${r.tries} points=${r.points} scrums=${r.scrums} lineouts=${r.lineouts} rucks=${r.rucks} tackles=${r.tackles} pens=${r.pens} passes=${r.passes} kicks=${r.kicks} phases=${r.phases}`);
    console.log(`counts: ${Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(`MVP A: ${r.ratingA}  MVP B: ${r.ratingB}`);
    console.log(r.box);
    for (const l of r.log) console.log('  !', l);
  }

  console.log('\n═══ GATES (across all seeds) ═══');
  for (const g of gates) {
    const pass = all.length > 0 && all.every(g.test);
    if (!pass) failures.push(g.id);
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${g.id.padEnd(14)} ${g.note}`);
  }
  console.log(failures.length === 0 ? '\nSIMCHECK GREEN' : `\nSIMCHECK FAILURES: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
