/**
 * T-03 — ENGINE/COMMENTARY. Extracted verbatim from director.ts: the event
 * bus drain (T-08), the speak/no-speak policy, and the IDLE -> BUILDUP ->
 * CLIMAX -> RESOLUTION sequencer (T-09). No behaviour change; the module
 * takes a Director reference and reads the same frameEvents the camera does.
 */

import type { Director } from '../director';
import { COMMENTARY_PAIRS } from '../jlr';
import { R } from './rng';

export function commentate(d: Director, key: string, extra?: string) {

  const bank = COMMENTARY_PAIRS.find((c) => c.key === key);
  if (!bank) return;
  /* T-09: a 20-second cooldown per COLOUR bank (big hits, weather, colour
   * lines). Event-critical banks — try, turnover, missed, line break —
   * always speak: two tries in twenty seconds both deserve their line. */
  const colour = ['BIG_HIT', 'GENERAL', 'WEATHER', 'BUILDUP', 'KICK', 'SCRUM', 'LINEOUT'].includes(key);
  if (colour && d.t - (d.bankLastAt[key] ?? -99) < 20) return;
  const last = d.feed[0]?.at ?? -99;
  if (d.t - last < 0.35) return;
  /* T-09: the no-repeat window is the last SIX spoken lines — nothing the
   * commentator said in the last six lines is said again. */
  let pick = bank.lines[Math.floor(R() * bank.lines.length)];
  for (let i = 0; i < 6 && d.recentLines.includes(pick[0]); i++) {
    pick = bank.lines[Math.floor(R() * bank.lines.length)];
  }
  if (d.recentLines.includes(pick[0])) return; // silence beats a parrot
  d.bankLastAt[key] = d.t;
  d.lastLineAt = d.t;
  d.recentLines.unshift(pick[0]);
  if (d.recentLines.length > 6) d.recentLines.pop();
  d.feed.unshift({ text: pick[0], text2: pick[1], at: d.t });
  if (extra) d.feed[0].text += ` ${extra}`;
  if (d.feed.length > 30) d.feed.pop();

}

export function commentarySequencer(d: Director) {

  for (const ev of d.frameEvents) {
    if (ev.type === 'LINE_BREAK') d.seqState = 'CLIMAX';
    else if (ev.type === 'TRY' || ev.type === 'TURNOVER' || ev.type === 'CARD') d.seqState = 'RESOLUTION';
  }
  /* A change of possession ends the build — the story is over either way. */
  if (d.seqLastPoss !== null && d.possession !== d.seqLastPoss) {
    d.phasesGained = 0;
    d.gainWindow.length = 0;
    if (d.seqState === 'BUILDUP') d.seqState = 'IDLE';
  }
  d.seqLastPoss = d.possession;
  if (d.seqState === 'RESOLUTION' && d.t - d.lastLineAt > 5) d.seqState = 'IDLE';
  /* The tension line: a sustained build with no break must be spoken about. */
  if (d.seqState === 'BUILDUP' && d.phasesGained >= 4
    && d.t - d.lastLineAt > 9 && d.t - (d.bankLastAt.BUILDUP ?? -99) > 20) {
    const m3 = d.gainWindow.reduce((a, b) => a + b, 0);
    d.commentate('BUILDUP', m3 > 3 ? '— AND THE GAIN LINE IS RETREATING' : '');
  }

}
