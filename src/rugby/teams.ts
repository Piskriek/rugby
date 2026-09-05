/**
 * Sixteen nations with kit colours and a rating, plus procedural squad
 * generation from the role archetypes in consts.ts. A nation's rating nudges
 * every player's attributes so squads feel distinct while staying realistic.
 */
import { ROLES, NAMES } from './consts';
import type { Side, Team, Player } from './types';
import type { RNG } from './rng';
import { range, irange } from './rng';

export interface Nation {
  id: string;
  name: string;
  short: string;
  rating: number;      // 0..100 overall
  color: string;       // primary kit
  color2: string;      // secondary kit
  trim: string;        // accent / number colour
}

export const NATIONS: Nation[] = [
  { id: 'ENG', name: 'England',    short: 'ENG', rating: 88, color: '#f2f3f7', color2: '#c8ccd6', trim: '#b3122f' },
  { id: 'FRA', name: 'France',     short: 'FRA', rating: 86, color: '#2b3a8f', color2: '#24306f', trim: '#f4f6fa' },
  { id: 'IRE', name: 'Ireland',    short: 'IRE', rating: 90, color: '#1f7a43', color2: '#185e34', trim: '#f4f6fa' },
  { id: 'SCO', name: 'Scotland',   short: 'SCO', rating: 83, color: '#1b3a6b', color2: '#142c52', trim: '#f4f6fa' },
  { id: 'WAL', name: 'Wales',      short: 'WAL', rating: 84, color: '#d3122e', color2: '#a90e25', trim: '#f4f6fa' },
  { id: 'NZL', name: 'New Zealand',short: 'NZL', rating: 93, color: '#16181c', color2: '#26282d', trim: '#f4f6fa' },
  { id: 'AUS', name: 'Australia',  short: 'AUS', rating: 85, color: '#e7b325', color2: '#c99a18', trim: '#14431f' },
  { id: 'RSA', name: 'South Africa',short:'RSA', rating: 92, color: '#1c6b3c', color2: '#15532e', trim: '#e7b325' },
  { id: 'ARG', name: 'Argentina',  short: 'ARG', rating: 82, color: '#6fb7e6', color2: '#5a9cc9', trim: '#1b2a4a' },
  { id: 'ITA', name: 'Italy',      short: 'ITA', rating: 76, color: '#2a6fd6', color2: '#2159ad', trim: '#f4f6fa' },
  { id: 'FIJ', name: 'Fiji',       short: 'FIJ', rating: 81, color: '#f2f3f7', color2: '#d7d9df', trim: '#16181c' },
  { id: 'JPN', name: 'Japan',      short: 'JPN', rating: 79, color: '#d81f2a', color2: '#b01620', trim: '#f4f6fa' },
  { id: 'SAM', name: 'Samoa',      short: 'SAM', rating: 78, color: '#1a3d8f', color2: '#14316f', trim: '#f4f6fa' },
  { id: 'TGA', name: 'Tonga',      short: 'TGA', rating: 77, color: '#c8102e', color2: '#a00d25', trim: '#f4f6fa' },
  { id: 'USA', name: 'USA',        short: 'USA', rating: 72, color: '#2b3a8f', color2: '#212e6f', trim: '#c8102e' },
  { id: 'CAN', name: 'Canada',     short: 'CAN', rating: 71, color: '#c8102e', color2: '#a00d25', trim: '#f4f6fa' },
];

export function nationById(id: string): Nation {
  return NATIONS.find((n) => n.id === id) ?? NATIONS[0];
}

/** Build the 15-man squad for a side. Seeded so the same seed → same team. */
export function buildSquad(side: Side, nation: Nation, rng: RNG): Player[] {
  const players: Player[] = [];
  const usedNames = new Set<number>();
  for (let i = 0; i < 15; i++) {
    const rd = ROLES[i];
    let ni = irange(rng, 0, NAMES.length - 1);
    let guard = 0;
    while (usedNames.has(ni) && guard++ < 32) ni = irange(rng, 0, NAMES.length - 1);
    usedNames.add(ni);
    // National bias: better nations get a higher ceiling, but the role shape stays.
    const lift = (nation.rating - 78) * 0.35; // ± ~5
    const jit = (v: number, w: number) =>
      Math.round(Math.max(35, Math.min(99, v + lift + range(rng, -w, w))));
    const att = {
      spd: jit(rd.att.spd, 3),
      str: jit(rd.att.str, 3),
      skl: jit(rd.att.skl, 3),
      kik: jit(rd.att.kik, 4),
    };
    players.push({
      id: side === 'A' ? i + 1 : i + 101,
      side, num: i + 1, role: rd.role,
      name: NAMES[ni],
      x: 0, y: 0, vx: 0, vy: 0, face: side === 'A' ? 0 : Math.PI,
      att, size: rd.size,
      stamina: 100, sprinting: false, burst: 0, decide: 0,
      down: 0, held: 0, bind: -1, slot: -1, sinbin: 0, ctrl: false,
    });
  }
  return players;
}

export function buildTeam(side: Side, nation: Nation, rng: RNG): Team {
  return {
    side, id: nation.id, name: nation.name, short: nation.short,
    color: nation.color, color2: nation.color2,
    score: 0, players: buildSquad(side, nation, rng),
  };
}
