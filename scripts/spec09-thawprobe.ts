/**
 * SPEC_09 THAW PROBE — mathematical verification of the restart thaw design.
 *
 * A1  PIN INTEGRITY / NO EARLY THAW: once a player is pinned to his restart
 *     slot, his end-of-tick position never changes until the strike tick.
 * A2  LAW 12 AT THE STRIKE: every receiver is at/behind the ten-metre line
 *     on the strike tick; every pinned kicking-side player is behind the ball.
 * A3  T-69 COMMITMENT: chasers.length === 6 on EVERY flight tick (including
 *     the strike tick itself — atomicity A1 of the design), all six resolve
 *     to eligible shirts, and the thaw gate never once held the freeze.
 * A4  TEE-BALL STERILITY: no pinned player within 1.0 m of the tee ball
 *     while the stage is AIM/METER (the kicker stands at 1.1 m and is exempt).
 * A5  THAW ORDERING: the ball has not moved at the end of the strike tick
 *     (first ball motion is T0+1; first player motion may be T0).
 * A6  OWNERSHIP SILENCE: zero [T-02] double-move warnings through every
 *     restart episode.
 * PLUS  THE FRONT DOOR (deterministic fixture): with a human-controlled
 *     receiver holding UP for the whole ritual, input cannot move him while
 *     the play-active gate is closed (AIM), and can the moment it opens
 *     (FLIGHT) — the pre-set steal's front door, tested directly.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

let fails = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) fails++;
};

/* ---- capture [T-02] ownership warnings (A6) ---- */
let t02Warnings = 0;
const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (args.join(' ').includes('[T-02]')) t02Warnings++;
  origWarn(...args);
};

const DT = 1 / 60;
const MATCHES_PER_DIFF = Number(process.argv[2] ?? 2);

/* ================= THE FRONT DOOR — TWIN-RUN PROOF =================
 * Two deterministic runs (same seed): one holds UP on the human receiver for
 * the whole ritual, one holds nothing. While the play-active gate is closed
 * the controlled man's position trace must be BIT-IDENTICAL — input provably
 * cannot move anyone. The tick the gate opens, the held run diverges. */
{
  const HELD = { left: false, right: false, up: true, down: false, run: false, sprint: false };
  const runFixture = (hold: boolean) => {
    seedRng(4242);
    const d = new Director(gateConfig(3));
    (d.teams as any).B.cpu = false;            // the receiving side is human
    d.setCtrl('B', 15);                         // fullback: NOT one of the six chasers (7,6,8,2,4,5)
    const me = () => d.live.find((p) => p.team === 'B' && p.num === 15)!;
    const closedTrace: Array<[number, number]> = [];
    let openTrace: Array<[number, number]> = [];
    let opened = false;
    for (let i = 0; i < 60 * 25; i++) {
      const k = d.kk;
      if (!k || (k.type !== 'RESTART' && k.type !== 'DROP_OUT') || (k.stage !== 'AIM' && k.stage !== 'METER' && k.stage !== 'FLIGHT')) break;
      /* The gate can open MID-tick (launch is step 3 of the pipeline, think is
       * step 5): classify each tick by the state AFTER the update, so the
       * strike tick — where input legally acts from the moment the ball is
       * live — belongs to the open trace, not the closed one. */
      d.update(DT, hold ? HELD : NO_INPUT, new Set(), new Set());
      const p = me();
      if (!(d as any).restartBallLive()) {
        closedTrace.push([p.x, p.z]);
      } else {
        opened = true;
        openTrace.push([p.x, p.z]);
        if (openTrace.length > 90) break;       // a second and a half of open play is plenty
      }
    }
    return { closedTrace, openTrace, opened };
  };
  const held = runFixture(true);
  const idle = runFixture(false);
  const identical = held.closedTrace.length === idle.closedTrace.length
    && held.closedTrace.every(([x, z], i) => x === idle.closedTrace[i][0] && z === idle.closedTrace[i][1]);
  check('DOOR input is DEAD while the gate is closed — held vs idle traces bit-identical',
    identical, `${held.closedTrace.length} vs ${idle.closedTrace.length} closed ticks, identical=${identical}`);
  check('DOOR both runs actually reached the open gate (episode struck)', held.opened && idle.opened);
  const first = held.openTrace[0], last = held.openTrace[held.openTrace.length - 1];
  const moved = first && last && Math.hypot(last[0] - first[0], last[1] - first[1]) > 1.5;
  const idleStill = idle.openTrace.length > 0
    && Math.hypot(idle.openTrace[idle.openTrace.length - 1][0] - idle.openTrace[0][0],
      idle.openTrace[idle.openTrace.length - 1][1] - idle.openTrace[0][1]) < Math.hypot(last[0] - first[0], last[1] - first[1]);
  check('DOOR held input moves the man once the gate opens (and idle moves less)', !!moved && !!idleStill,
    `held moved ${first && last ? Math.hypot(last[0] - first[0], last[1] - first[1]).toFixed(1) : '?'} m`);
}

/* ================= THE SIX ASSERTIONS, HEADLESS MATCHES ================= */
let episodes = 0, strikes = 0;
let pinViolations = 0, law12Violations = 0, teeViolations = 0;
let commitmentViolations = 0, eligibilityIssues = 0, thawHolds = 0;
let ballMovedAtStrike = 0, liveViolations = 0;
let strikeGapMin = 999, strikeGapWhere = '';

for (const diff of [0, 3, 6, 9]) {
  for (let m = 0; m < MATCHES_PER_DIFF; m++) {
    seedRng(1000 + diff * 100 + m);   // reproducible episodes (SPEC_05 seam)
    const d = new Director(gateConfig(diff));
    interface Ep {
      kk: unknown; dir: number; markX: number; markZ: number;
      pinned: Map<string, { team: 'A' | 'B'; num: number; x: number; z: number }>;
      struck: boolean; strikeTick: number;
      ballX: number; ballZ: number; ballMovedTick: number | null;
    }
    let ep: Ep | null = null;
    for (let tick = 0; tick < 100 * 60 && !d.over; tick++) {
      d.update(DT, NO_INPUT, new Set(), new Set());
      const k = d.kk as any;
      if (!k || (k.type !== 'RESTART' && k.type !== 'DROP_OUT')) { ep = null; continue; }
      if (!ep || ep.kk !== k) {
        episodes++;
        ep = {
          kk: k, dir: k.dir, markX: k.bx, markZ: k.bz,
          pinned: new Map(), struck: false, strikeTick: -1,
          ballX: k.bx, ballZ: k.bz, ballMovedTick: null,
        };
      }
      const byKey = new Map(d.live.map((p) => [`${p.team}${p.num}`, p]));

      if (!ep.struck && (k.stage === 'AIM' || k.stage === 'METER')) {
        /* A1 + A4 while the ritual holds. A player is PINNED when he stands
         * exactly on his slot (place() writes the exact coordinates); the
         * 0.8 m approach under steer() is walking, not pinning. */
        for (const f of k.form ?? []) {
          const p = byKey.get(`${f.team}${f.num}`);
          if (!p) continue;
          if (Math.hypot(f.x - p.x, f.z - p.z) < 1e-6) {
            const key = `${f.team}${f.num}`;
            const prev = ep.pinned.get(key);
            if (prev && Math.hypot(prev.x - p.x, prev.z - p.z) > 1e-6) pinViolations++;
            ep.pinned.set(key, { team: f.team, num: f.num, x: p.x, z: p.z });
          }
        }
        for (const t of ep.pinned.values()) {
          if (t.team === k.kicker && t.num === k.kickerNum) continue;
          if (Math.hypot(t.x - k.bx, t.z - k.bz) < 1.0) teeViolations++;
        }
      }

      if (!ep.struck && k.stage === 'FLIGHT') {
        /* the strike landed THIS tick */
        ep.struck = true; ep.strikeTick = tick; strikes++;
        if (d.watchdogLog.some((l) => l.includes('SPEC_09 thaw held'))) thawHolds++;
        /* A5: no ball motion at the end of the strike tick */
        if (Math.hypot(k.bx - ep.markX, k.bz - ep.markZ) > 1e-6) ballMovedAtStrike++;
        /* A2: Law 12 geometry at the strike */
        for (const p of d.live) {
          if (p.team === k.kicker || p.sinbin > 0) continue;
          const g = (p.z - k.bz) * k.dir;
          if (g < strikeGapMin) { strikeGapMin = g; strikeGapWhere = `d${diff}m${m} ${k.type} t${tick}`; }
        }
        for (const t of ep.pinned.values()) {
          const g = (t.z - k.bz) * k.dir;
          if (t.team === k.kicker && g > -1.0) law12Violations++;      // kicker-side pinned: behind the ball
          if (t.team !== k.kicker && g < 10.5) law12Violations++;      // receiver pinned: behind the ten
        }
      }

      if (k.stage === 'FLIGHT') {
        /* A3: the commitment, every flight tick, strike tick included */
        if (k.chasers.length !== 6) commitmentViolations++;
        else for (const c of k.chasers) {
          const p = byKey.get(`${k.kicker}${c.num}`);
          if (!p || p.sinbin > 0 || p.down) eligibilityIssues++;
        }
        if (!(d as any).restartBallLive()) liveViolations++;
        /* A5: the ball's first motion must be the tick AFTER the strike */
        if (ep.ballMovedTick === null && Math.hypot(k.bx - ep.ballX, k.bz - ep.ballZ) > 1e-6) {
          ep.ballMovedTick = tick;
          if (tick <= ep.strikeTick) ballMovedAtStrike++;
        }
        ep.ballX = k.bx; ep.ballZ = k.bz;
      }
    }
  }
}

console.log(`      (${episodes} restart episodes, ${strikes} strikes observed; min receiver gap at strike ${strikeGapMin === 999 ? 'n/a' : strikeGapMin.toFixed(2)} m @ ${strikeGapWhere || '-'}; ${MATCHES_PER_DIFF * 4} matches at difficulties 0/3/6/9)`);
check('A1 pin integrity — no player unfreezes before the strike tick', pinViolations === 0, `${pinViolations} pre-strike pin movements`);
check('A2 Law 12 at the strike — receivers behind ten, kickers behind ball', law12Violations === 0 && strikeGapMin >= 10.0, `${law12Violations} geometry violations, min gap ${strikeGapMin.toFixed(2)} m`);
check('A3 T-69 commitment — six eligible chasers on EVERY flight tick, thaw never held', commitmentViolations === 0 && eligibilityIssues === 0 && thawHolds === 0, `${commitmentViolations} length, ${eligibilityIssues} eligibility, ${thawHolds} thaw holds`);
check('A4 tee-ball sterility — nobody pre-set at the ball during AIM', teeViolations === 0, `${teeViolations} violations`);
check('A5 thaw ordering — ball motion begins the tick AFTER the strike', ballMovedAtStrike === 0, `${ballMovedAtStrike} strike-tick ball motions`);
check('A6 ownership silence — zero [T-02] double-move warnings', t02Warnings === 0, `${t02Warnings} warnings`);

console.log(fails === 0 ? 'SPEC_09 THAW PROBE: ALL GREEN — the pre-set steal is dead' : `SPEC_09 THAW PROBE: ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
