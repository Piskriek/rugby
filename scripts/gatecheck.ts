/**
 * gatecheck.ts — one command that answers "is this branch fit to merge?"
 *
 * Every other harness in this repo answers one narrow question, and that is
 * correct for tuning but useless for a verdict: the tree has seventeen of them,
 * they take different arguments, and a reviewer who runs nine of them has run
 * none of them. This is the tenth opinion and the first complete one — it shells
 * out to the real commands, reads their real exit codes and their own reported
 * numbers, and prints a single scoreboard. `--fast` skips the two that cost tens
 * of seconds (the production build and the rule audit) so a session can gate a
 * single commit cheaply and still gate nothing twice by hand.
 *
 *   npx vite-node scripts/gatecheck.ts            full verdict
 *   npx vite-node scripts/gatecheck.ts --fast      everything but build + audit
 *   npx vite-node scripts/gatecheck.ts --only sceneaudit,handsprobe
 *
 * Exit code is 0 only when every gate passes, which is the property a CI job or a
 * branch protect wants. Nothing here is a new measurement: the numbers are quoted
 * from the harnesses themselves, so a disagreement between this file and a probe is
 * always the probe's fault to fix, never this file's to smooth over.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const fast = argv.includes('--fast');
const only = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(',').map((s) => s.trim()) : null;
})();

const ROOT = path.resolve(import.meta.dirname, '..');

interface Gate {
  /** the short name reviewers use in `--only` */
  id: string;
  /** what it is actually for, in the language of the failure it catches */
  asks: string;
  /** scripts/<file>.ts this gate runs, when there is one — the orphan sweep needs
   *  the file name, not the gate's display id, because `audit` runs `audit-cli.ts` */
  file?: string;
  cmd: string[];
  /** seconds allotted; a harness that exceeds it is reported as STALLED rather
   *  than silently killed, because a stalled check and a passing one look the same
   *  from the outside and only one of them is a lie. */
  budget: number;
  /** skip in --fast */
  slow?: boolean;
}

/* `npx --no-install` rather than a resolved binary path: the gate has to work in a
 * fresh clone that forgot `npm install` by failing loudly ("could not determine
 * executable to run") instead of quietly passing on a stale tree, and it must not
 * download anything to make itself look green. */
const VN = ['npx', '--no-install', 'vite-node'];

const GATES: Gate[] = [
  {
    id: 'tsc',
    asks: 'does the tree typecheck at all',
    file: 'tsc',
    cmd: ['npx', '--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.json'],
    budget: 240,
  },
  {
    id: 'sceneaudit',
    asks: 'is a match actually on screen — bodies drawn, pitch green, a man big enough to read',
    cmd: [...VN, 'scripts/sceneaudit.ts'], file: 'sceneaudit',
    budget: 300,
  },
  {
    id: 'breakdownprobe', file: 'breakdownprobe',
    asks: 'the presimulated ruck: no teleport, arrival order, clearouts that move a man, a ball that comes out',
    cmd: [...VN, 'scripts/breakdownprobe.ts', '120', '3', '1'],
    budget: 420,
  },
  {
    id: 'handsprobe', file: 'handsprobe',
    asks: 'the grapple: hands reach, grips cost time, a lone jackal never steals, and the whole thing is 2 µs',
    cmd: [...VN, 'scripts/handsprobe.ts', '90', '3', '1 2 3'],
    budget: 420,
  },
  {
    id: 'ballikprobe', file: 'ballikprobe',
    asks: 'SPEC_25 — the catch state machine, the two-bone IK, the 300 ms drop window and the punt impulse',
    cmd: [...VN, 'scripts/ballikprobe.ts', '20', '3', '1 2'],
    budget: 420,
  },
  {
    id: 'bootcheck', file: 'bootcheck',
    asks: 'the boot never hangs and never goes blank: staged, budgeted, and it explains itself when it cuts short',
    cmd: [...VN, 'scripts/bootcheck.ts'],
    budget: 300,
  },
  {
    id: 'teleprobe', file: 'teleprobe',
    asks: 'no actor is repositioned by more than a stride in a frame, at three difficulties',
    cmd: [...VN, 'scripts/teleprobe.ts'],
    budget: 300,
  },
  {
    id: 'ragdollcheck', file: 'ragdollcheck',
    asks: 'the fall solver: one floor, clamped velocities, no per-substep scaling traps',
    cmd: [...VN, 'scripts/ragdollcheck.ts'],
    budget: 300,
  },
  {
    id: 'renderverify', file: 'renderverify',
    asks: 'the render decisions are still the documented ones (single encode, colour space, tone curve)',
    cmd: [...VN, 'scripts/renderverify.ts'],
    budget: 300,
  },
  {
    id: 'cameraverify', file: 'cameraverify',
    asks: 'the unified first/third-person rig: one owner for the look, a lens that cannot leave the enclosure, cost in nanoseconds',
    cmd: [...VN, 'scripts/cameraverify.ts'],
    budget: 300,
  },
  {
    id: 'viewprobe', file: 'viewprobe',
    asks: 'the matchday picture is not a black rectangle — meshes, lights and something other than sky',
    cmd: [...VN, 'scripts/viewprobe.ts'],
    budget: 300,
  },
  {
    id: 'healthverify', file: 'healthverify',
    asks: 'a broken picture says so: the render-health ladder ranks a root cause above its own symptom',
    cmd: [...VN, 'scripts/healthverify.ts'],
    budget: 240,
  },
  {
    id: 'turfverify', file: 'turfverify',
    asks: 'the turf is one mesh, outward normals, and it builds in a frame budget',
    cmd: [...VN, 'scripts/turfverify.ts'],
    budget: 300,
  },
  {
    id: 'glslcheck', file: 'glslcheck',
    asks: 'every shader literal still compiles and has no stray backtick or smoothstep(a,b,x) with a>b',
    cmd: [...VN, 'scripts/glslcheck.ts'],
    budget: 240,
  },
  {
    id: 'spec07-contracts',
    asks: 'score integrity: every law call, ledger row and gate block is surfaced',
    cmd: [...VN, 'scripts/spec07-contracts.ts'], file: 'spec07-contracts',
    budget: 300,
  },
  {
    id: 'matchdayheadless', file: 'matchdayheadless',
    asks: 'the matchday presentation layer survives a real frame, a weather matrix, a reset and a teardown',
    cmd: [...VN, 'scripts/matchdayheadless.ts'],
    budget: 420,
  },
  {
    id: 'spec08-smoke', file: 'spec08-smoke',
    asks: 'the stall ladder: a frozen replay never stands still, and the 15 s backstop awards before it fires',
    cmd: [...VN, 'scripts/spec08-smoke.ts'],
    budget: 240,
  },
  {
    id: 'spec09-thawprobe', file: 'spec09-thawprobe',
    asks: 'restart thaw sequencing: ball motion begins the tick after the strike, and no side moves twice',
    cmd: [...VN, 'scripts/spec09-thawprobe.ts'],
    budget: 240,
  },
  {
    id: 't43check', file: 't43check',
    asks: 'the set-piece freeze: a replay holds still while the phase actually restarts',
    cmd: [...VN, 'scripts/t43check.ts'],
    budget: 240,
  },
  {
    id: 'audit',
    asks: 'the rule audit: LAW / UX / LOGIC failures across a real 120 s match',
    cmd: [...VN, 'scripts/audit-cli.ts', '120', '3', '1'], file: 'audit-cli',
    budget: 420,
    slow: true,
  },
  {
    id: 'build',
    asks: 'the production single-file build still links',
    cmd: ['npx', '--no-install', 'vite', 'build'],
    budget: 600,
    slow: true,
  },
];

interface Row {
  /** the tail of the harness's own output, kept for the checks that report numbers
   *  without reporting a nonzero exit code — which is how a gate goes soft */
  blob?: string;
  id: string;
  asks: string;
  verdict: 'PASS' | 'FAIL' | 'STALLED' | 'SKIP';
  detail: string;
  seconds: number;
}

function run(g: Gate): Row {
  const t0 = Date.now();
  const r = spawnSync(g.cmd[0], g.cmd.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: g.budget * 1000,
    maxBuffer: 32 << 20,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const seconds = (Date.now() - t0) / 1000;
  const blob = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const lines = blob.split('\n').map((l) => l.trim()).filter(Boolean);
  const fails = lines.filter((l) => /^(FAIL|\s*\d+ FAIL(ING|URE))/i.test(l));
  const verdict: Row['verdict'] = r.status === 0 ? 'PASS' : (r.signal === 'SIGTERM' ? 'STALLED' : 'FAIL');
  /* The detail line is the harness's own headline number when it has one — a
   * count, a worst-case step, a pass total — because a scoreboard of bare PASSes
   * is how a build passes while getting worse. */
  const numbers = lines.filter((l) => /\b(worst|mean|PASS \d+|built in|across|µs|px)\b/.test(l)).slice(-2);
  const detail = verdict === 'PASS'
    ? (numbers[0] ?? lines.at(-1) ?? '').slice(0, 96)
    : (fails[0] ?? lines.filter((l) => /error/i.test(l))[0] ?? lines.at(-1) ?? '').slice(0, 96);
  return { id: g.id, asks: g.asks, verdict, detail, seconds, blob: blob.slice(-8000) };
}

/** A guard against the failure mode this repo has seen twice now: a check that is
 *  not in the list. A harness added to scripts/ without being added to GATES is a
 *  hole in the gate, so the gate says so out loud instead of trusting itself. */
function unrunHarnesses(): { name: string; checks: number }[] {
  const dir = path.join(ROOT, 'scripts');
  if (!existsSync(dir)) return [];
  const named = new Set(GATES.map((g) => g.file ?? g.id));
  /* Helpers and one-shot authoring tools are not verdicts: `_nodeCanvas` is a shared
   * stub, `shoot` needs a browser this sandbox has never had, `camaudit`/`lookprobe`
   * are A/B rigs you point at a question, `*bake*`/`fetch*` regenerate assets. */
  const skipped = new Set(['_nodeCanvas', 'shoot', 'gatecheck', 'camaudit', 'lookprobe',
    'crownprobe', 'breakdownbake', 'ragdollbake', 'auditcompare', 'gates', 'gates2',
    'gatesprobe', 'spec05probe', 'ballstate', 'pngout', 'tp', 'trace_ep', 'feedlog']);
  const out: { name: string; checks: number }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.startsWith('_')) continue;
    const name = f.replace(/\.ts$/, '');
    if (named.has(name) || skipped.has(name) || name.endsWith('bake')) continue;
    /* Only files that can actually FAIL are worth nagging about. A probe that prints
     * numbers and exits 0 is an instrument, not a gate, and the repo has sixty of
     * those; conflating them is how a useful sweep becomes noise people switch off. */
    let src = '';
    try { src = readFileSync(path.join(dir, f), 'utf8'); } catch (e) {
      console.error(`gatecheck: cannot read scripts/${f}: ${(e as Error).message}`);
      process.exit(2);
    }
    if (!/\bcheck\s*\(/.test(src) && !/process\.exit\(\s*1\s*\)/.test(src)) continue;
    out.push({ name, checks: (src.match(/\bcheck\s*\(\s*['"`]/g) ?? []).length });
  }
  return out.sort((a, b) => b.checks - a.checks);
}

const selected = only ? GATES.filter((g) => only.includes(g.id)) : GATES;
/** THE RATCHET. `audit-cli` prints `FAIL 5` and exits 0, so trusting exit codes
 *  alone means a session can add law failures and still read green — the exact way a
 *  gate rots. The recorded baseline is checked in, exceeding it is red, beating it is
 *  green with a note to lower it in the same commit. */
interface Baseline { audit?: { fail: number; warn: number }; [k: string]: unknown }
function readBaseline(): Baseline {
  try {
    const raw = readFileSync(path.join(ROOT, 'scripts', 'gate-baseline.json'), 'utf8');
    return JSON.parse(raw) as Baseline;
  } catch {
    return {};
  }
}

const rows: Row[] = [];
for (const g of selected) {
  if (fast && g.slow) {
    rows.push({ id: g.id, asks: g.asks, verdict: 'SKIP', detail: '--fast', seconds: 0 });
    continue;
  }
  process.stderr.write(`· ${g.id} … `);
  const row = run(g);
  process.stderr.write(`${row.verdict} ${row.seconds.toFixed(0)}s\n`);
  rows.push(row);
}

const baseline = readBaseline();
const notes: string[] = [];
for (const r of rows) {
  if (r.id !== 'audit' || !r.blob) continue;
  const m = r.blob.match(/PASS\s+(\d+)\s+WARN\s+(\d+)\s+FAIL\s+(\d+)/);
  if (!m) { r.verdict = 'FAIL'; r.detail = 'audit printed no PASS/WARN/FAIL line — the format moved, fix the ratchet'; continue; }
  const [, pass, warn, f] = m;
  const want = baseline.audit ?? { fail: Number(f), warn: Number(warn) };
  if (Number(f) > want.fail) {
    r.verdict = 'FAIL';
    r.detail = `FAIL ${f} against a baseline of ${want.fail} (+${Number(f) - want.fail}) — ${r.detail}`;
  } else if (Number(f) < want.fail) {
    notes.push(`ratchet: the audit improved to FAIL ${f} (baseline ${want.fail}) — lower scripts/gate-baseline.json to ${f} in this commit.`);
  }
  if (Number(warn) > want.warn + 4) {
    notes.push(`the audit's WARN count is ${warn}, ${want.warn} at baseline — +${Number(warn) - want.warn} is a drift worth a sentence in the commit body.`);
  }
  r.detail = `PASS ${pass} · WARN ${warn} · FAIL ${f} (baseline ${want.fail})`;
}

const fail = rows.filter((r) => r.verdict !== 'PASS' && r.verdict !== 'SKIP');
const width = Math.max(...rows.map((r) => r.id.length));
console.log('');
console.log('GATE CHECK — the merge verdict, one line per harness');
console.log('─'.repeat(100));
for (const r of rows) {
  const mark = r.verdict === 'PASS' ? 'ok  ' : r.verdict === 'SKIP' ? 'skip' : 'FAIL';
  console.log(`${mark}  ${r.id.padEnd(width)}  ${r.detail}`);
  if (r.verdict !== 'PASS' && r.verdict !== 'SKIP') console.log(`       ${' '.repeat(width)}  ${r.asks}`);
}
console.log('─'.repeat(100));
for (const n of notes) console.log(`⚑ ${n}`);
const orphans = unrunHarnesses();
if (orphans.length) {
  const show = argv.includes('--orphans') ? orphans : orphans.slice(0, 12);
  console.log(`⚠ ${orphans.length} script(s) in scripts/ can fail but are not part of the verdict:`);
  for (const o of show) console.log(`    ${o.name.padEnd(22)} ${o.checks} check(s)`);
  if (show.length < orphans.length) {
    console.log(`    … ${orphans.length - show.length} more — npx vite-node scripts/gatecheck.ts --orphans`);
  }
  console.log('  A check nobody wires into the verdict is a check that gets forgotten. Fold it in, or delete it.');
}
const secs = rows.reduce((m, r) => m + r.seconds, 0);
console.log(fail.length
  ? `\n${fail.length} OF ${rows.length - (fast ? 2 : 0)} GATES RED — do not merge (${secs.toFixed(0)}s)`
  : `\nALL GATES GREEN${fast ? ' (fast: build + audit skipped)' : ''} — fit to merge (${secs.toFixed(0)}s)`);
process.exit(fail.length ? 1 : 0);
