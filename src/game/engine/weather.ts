/**
 * T-03 — ENGINE/WEATHER. The shared pitch-condition helpers, extracted
 * verbatim from director.ts so every engine module reads the same sky.
 */

export function wetnessOf(weather: string): number {
  return weather === 'RAIN' ? 1 : weather === 'DRIZZLE' ? 0.55 : weather === 'GALE' ? 0.4 : weather === 'FOG' ? 0.35 : 0.12;
}
export function windOf(o: Record<string, number>): number {
  return [0.02, 0.12, 0.24, 0.4, 0.55][o.wind ?? 1] ?? 0.12;
}
export const WEATHERS = ['CLEAR', 'OVERCAST', 'DRIZZLE', 'RAIN', 'FOG', 'COLD SNAP', 'GALE'];
