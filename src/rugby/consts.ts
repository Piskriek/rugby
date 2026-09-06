/**
 * World constants: pitch geometry, role archetypes, scoring values,
 * set-piece slot geometry. Pure data — nothing here moves a player.
 */
import type { Role, Attr } from './types';

/* Pitch in metres. x runs along the length (-50..+50), y across (-35..+35).
 * Team A attacks +x (their try line at +50); team B attacks -x. */
export const PITCH = { L: 100, W: 70, HALF: 50, INGOAL: 10 };
export const TOUCH_Y = PITCH.W / 2;                 // 35
export const TRY_X = PITCH.HALF;                    // 50
export const DEAD_X = PITCH.HALF + PITCH.INGOAL;    // 60

export const POINTS = { TRY: 5, CONVERSION: 2, PENALTY: 3, DROP_GOAL: 3 };

/** Where the important field lines sit (absolute |x|). */
export const LINES = { halfway: 0, twentyTwo: 28, ten: 40, five: 45, try: 50 };

/* ---- role archetypes (shirt number → role → base ratings) ---- */
export interface RoleDef { role: Role; label: string; att: Attr; size: number }
export const ROLES: RoleDef[] = [
  { role: 'PROP',    label: 'PROP',      att: { spd: 55, pwr: 95, skl: 60, agg: 82, awa: 68, sta: 78, kik: 40 }, size: 1.10 },
  { role: 'HOOKER',  label: 'HOOKER',    att: { spd: 60, pwr: 90, skl: 65, agg: 80, awa: 72, sta: 76, kik: 45 }, size: 1.05 },
  { role: 'PROP',    label: 'PROP',      att: { spd: 55, pwr: 95, skl: 60, agg: 82, awa: 68, sta: 78, kik: 40 }, size: 1.10 },
  { role: 'LOCK',    label: 'LOCK',      att: { spd: 58, pwr: 92, skl: 60, agg: 78, awa: 66, sta: 80, kik: 45 }, size: 1.12 },
  { role: 'LOCK',    label: 'LOCK',      att: { spd: 58, pwr: 92, skl: 60, agg: 78, awa: 66, sta: 80, kik: 45 }, size: 1.12 },
  { role: 'FLANKER', label: 'FLANKER',   att: { spd: 71, pwr: 85, skl: 72, agg: 90, awa: 78, sta: 82, kik: 55 }, size: 1.00 },
  { role: 'FLANKER', label: 'FLANKER',   att: { spd: 73, pwr: 84, skl: 74, agg: 90, awa: 80, sta: 82, kik: 55 }, size: 1.00 },
  { role: 'NO8',     label: 'NO. 8',     att: { spd: 72, pwr: 88, skl: 76, agg: 84, awa: 74, sta: 80, kik: 60 }, size: 1.04 },
  { role: 'SH',      label: 'SCRUM-HALF',att: { spd: 78, pwr: 58, skl: 88, agg: 72, awa: 90, sta: 74, kik: 80 }, size: 0.93 },
  { role: 'FH',      label: 'FLY-HALF',  att: { spd: 74, pwr: 60, skl: 90, agg: 70, awa: 88, sta: 74, kik: 88 }, size: 0.95 },
  { role: 'WING',    label: 'WING',      att: { spd: 95, pwr: 55, skl: 78, agg: 66, awa: 70, sta: 72, kik: 70 }, size: 0.92 },
  { role: 'CTR',     label: 'CENTRE',    att: { spd: 80, pwr: 70, skl: 84, agg: 78, awa: 80, sta: 76, kik: 70 }, size: 0.96 },
  { role: 'CTR',     label: 'CENTRE',    att: { spd: 82, pwr: 72, skl: 82, agg: 78, awa: 82, sta: 76, kik: 68 }, size: 0.98 },
  { role: 'WING',    label: 'WING',      att: { spd: 95, pwr: 55, skl: 78, agg: 66, awa: 70, sta: 72, kik: 70 }, size: 0.92 },
  { role: 'FB',      label: 'FULLBACK',  att: { spd: 88, pwr: 62, skl: 80, agg: 62, awa: 86, sta: 74, kik: 82 }, size: 0.94 },
];

/** First names drawn from for generated squads (broadly international). */
export const NAMES = [
  'Aneurin', 'Bran', 'Callum', 'Dafydd', 'Ewan', 'Fionn', 'Gareth', 'Hamish',
  'Iolo', 'Jamie', 'Kane', 'Liam', 'Morgan', 'Niall', 'Owen', 'Pádraig',
  'Rhys', 'Seán', 'Tadhg', 'Ulric', 'Vaughan', 'Wyn', 'Angus', 'Boyd',
  'Ciaran', 'Declan', 'Eoin', 'Fergus', 'Graham', 'Hugh', 'Iain', 'Keir',
  'Rory', 'Ross', 'Stuart', 'Fraser', 'Alun', 'Ben', 'Corey', 'Dylan',
  'Jordan', 'Levi', 'Mako', 'Nepo', 'Ofa', 'Rieko', 'Sam', 'Taniela',
  'Ardie', 'Brodie', 'Caleb', 'Dane', 'Elton', 'Folau', 'George', 'Harry',
  'Isa', 'James', 'Kurtley', 'Lukhan', 'Marika', 'Ned', 'Ollie', 'Petrus',
  'Quinten', 'Ruan', 'Siya', 'Teboho', 'Vince', 'Will', 'Xola', 'Zane',
];

/* ---- pitch geometry helpers ---- */

/** metres between two points */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** clamp to pitch playing area (with a small margin so play never glues to a line) */
export function clampPitch(x: number, y: number): [number, number] {
  return [Math.max(-TRY_X, Math.min(TRY_X, x)), Math.max(-TOUCH_Y, Math.min(TOUCH_Y, y))];
}

/** the attack direction for a side (+1 for A toward +x, -1 for B) */
export function attackDir(side: 'A' | 'B'): number {
  return side === 'A' ? 1 : -1;
}
