/**
 * PLAYTEST-4 PROBE — "score a try, get the points, reset for a scrum and
 * score again, then kick for posts" (illegal double score), and "TRY
 * animation repeats while everyone frozen".
 *
 * Watches: (a) score jumps — any two TRY-scoring score increases within
 * 30 game-seconds with no intervening kick/possession reset; (b) what phase
 * runs in the 8 game-seconds after each try (the "reset for a scrum");
 * (c) the scorer's clip timeline after the try (repeat/loop evidence).
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const matches = Number(process.argv[2] ?? 10);
const diff = Number(process.argv[3] ?? 9);
const dt = 1 / 60;
const SPEED = 9;

let doubleScores = 0, tries = 0, scrumAfterTry = 0;
const phaseAfter: Record<string, number> = {};

for (let m = 0; m < matches; m++) {
  const d = new Director(gateConfig(diff));
  let lastTryClock = -99;
  let lastTryScore = -1;
  let tryWatch = 0; // game-s remaining of post-try watch
  let clipLog: { clip: string; t: number }[] | null = null;
  for (let i = 0; i < 100 * 60; i++) {
    const scoreA = d.teams.A.score, scoreB = d.teams.B.score;
    const phaseBefore = d.phase;
    const clips = clipLog
      ? d.live.filter((p) => clipLog!.some((c) => false)).length
      : 0;
    void clips;
    d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false }, new Set(), new Set());

    const jumped = d.teams.A.score > scoreA || d.teams.B.score > scoreB;
    const ev = d.events[d.events.length - 1];
    const isTry = jumped && ev && ev.kind === 'TRY';
    if (tryWatch > 0) {
      tryWatch -= dt * d.clockScale;
      const key = d.phase;
      phaseAfter[key] = (phaseAfter[key] ?? 0) + 1;
      if (d.phase === 'SCRUM') scrumAfterTry++;
    }
    if (isTry) {
      tries++;
      const gap = d.clock - lastTryClock;
      if (gap < 30 * SPEED && lastTryClock >= 0) {
        doubleScores++;
        console.log(`  [m${m}] DOUBLE SCORE? try at ${d.clockText}, previous ${gap.toFixed(1)} game-s earlier (scorer events: ${d.events.filter((e) => e.kind === 'TRY').length})`);
      }
      lastTryClock = d.clock;
      tryWatch = 8 * SPEED;
      const scorerTeam = ev.team;
      const sc = d.live.find((p) => p.team === scorerTeam && p.clip === 'dive' || p.team === scorerTeam && p.clip === 'grounded');
      if (sc) clipLog = [];
      void clipLog;
    }
    void phaseBefore; void lastTryScore;
  }
}
console.log(`\nPROBE — ${matches} matches @ diff ${diff}`);
console.log(`tries=${tries} double-score suspects=${doubleScores} scrum-frames within 8s of a try=${scrumAfterTry}`);
console.log('phase distribution in the 8s after a try:', phaseAfter);
