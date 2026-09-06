/** Small deterministic RNG — matches are reproducible from a seed. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  next(): number {
    // mulberry32 — tiny, fast, good enough for a match engine.
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const angleTo = (ax: number, ay: number, bx: number, by: number) => Math.atan2(by - ay, bx - ax);

export function shuffle<T>(r: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Clamp a heading difference to [-π, π]. */
export const wrapAngle = (d: number) => {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Format seconds -> m:ss clock. */
export const clockLabel = (s: number, halfLen: number): string => {
  const total = halfLen * 60;
  const remain = Math.max(0, total - s);
  const m = Math.floor(remain / 60);
  const sec = Math.floor(remain % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const minuteLabel = (s: number): string => `${Math.floor(s / 60)}'`;

/** Deterministic string hash (keeps lineups stable across platforms). */
export const hashStr = (str: string): number => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
};
