/** T-03 — shared numeric clamp for the engine modules. */
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
