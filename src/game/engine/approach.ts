/** T-03 — the shared exponential approach used by every engine module. */
export const approach = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
