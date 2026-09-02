/**
 * ANIMATION CORE — easing curves + channel poses.
 * Sampling is exact (no frame snapping) so motion is smooth at any timestep.
 */

export type Ease =
  | 'hold' | 'linear' | 'sineIn' | 'sineOut' | 'sineInOut'
  | 'quadIn' | 'quadOut' | 'cubicIn' | 'cubicOut' | 'cubicInOut'
  | 'backIn' | 'backOut' | 'circOut' | 'expoOut' | 'elasticOut' | 'bounceOut';

export function ease(kind: Ease, t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (kind) {
    case 'hold': return 0;
    case 'linear': return x;
    case 'sineIn': return 1 - Math.cos((x * Math.PI) / 2);
    case 'sineOut': return Math.sin((x * Math.PI) / 2);
    case 'sineInOut': return -(Math.cos(Math.PI * x) - 1) / 2;
    case 'quadIn': return x * x;
    case 'quadOut': return 1 - (1 - x) * (1 - x);
    case 'cubicIn': return x * x * x;
    case 'cubicOut': return 1 - Math.pow(1 - x, 3);
    case 'cubicInOut': return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'backIn': { const c = 1.70158; return c * x * x * x - (c + 1) * x * x; }
    case 'backOut': { const c = 1.70158; const u = x - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
    case 'circOut': return Math.sqrt(1 - Math.pow(x - 1, 2));
    case 'expoOut': return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
    case 'elasticOut': {
      if (x === 0 || x === 1) return x;
      const c = (2 * Math.PI) / 3;
      return Math.pow(2, -9 * x) * Math.sin((x * 10 - 0.75) * c) + 1;
    }
    case 'bounceOut': {
      const n = 7.5625, d = 2.75;
      let y = x;
      if (y < 1 / d) return n * y * y;
      if (y < 2 / d) return n * (y -= 1.5 / d) * y + 0.75;
      if (y < 2.5 / d) return n * (y -= 2.25 / d) * y + 0.9375;
      return n * (y -= 2.625 / d) * y + 0.984375;
    }
  }
}

export const D = Math.PI / 180;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const approach = (a: number, b: number, rate: number, dt: number) =>
  a + (b - a) * (1 - Math.exp(-rate * dt));
