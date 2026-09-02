/**
 * T-03 — ENGINE/CLOCK. Extracted verbatim from director.ts: half and full
 * time, the unattended auto-resume, and the closing whistle. No behaviour
 * change; the clock state stays on the Director.
 */

import { Director } from '../director';

export function endHalf(d: Director, ) {

  if (d.half === 1) {
    d.say(`HALF TIME. ${d.teams.A.nation.short} ${d.teams.A.score} — ${d.teams.B.score} ${d.teams.B.nation.short}`);
    d.banner_('HALF TIME');
    d.paused = true;
    d.half = 2;
    d.clock = 0;
    d.addedTime = 0;
    /* T-18. In a CPU-v-CPU match nobody presses the "SECOND HALF" button —
     * the half-time freeze lasted forever, and every simulated "match" was
     * one half plus three-quarters of the engine's time budget spent
     * frozen at the banner. That single dead span was why every box-score
     * statistic read at half strength. Resume by itself after a beat. */
    if (!d.isHuman('A') && !d.isHuman('B')) {
      d.holdTimer = 2.5;
    }
    return;
  }
  d.endMatch();
}

export function resumeSecondHalf(d: Director, ) {

  d.paused = false;
  d.startKick(d.teams.A.score >= d.teams.B.score ? 'B' : 'A', 'RESTART', { x: 0, z: 0 });
}

export function endMatch(d: Director, ) {

  d.over = true;
  d.commentate('GENERAL', '— AND THAT IS FULL TIME');
  d.banner_(`FULL TIME  ${d.teams.A.nation.short} ${d.teams.A.score} — ${d.teams.B.score} ${d.teams.B.nation.short}`);
}
