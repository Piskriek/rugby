/** T-03 — the shared exponential approach used by every engine module. */
export const approach = (a: number, b: number, rate: number, dt: number): number => {
  /* Endurance hardening: this primitive sits under every velocity and
   * position smoother in the engine. If either end is non-finite (a bad
   * frame upstream, a torn-down state), propagating the NaN into the write
   * is exactly how a single glitched frame becomes a whole-body explosion.
   * Snap to the finite end instead — the target when there is one, zero when
   * there is not. A finite result is a legal engine value; a NaN is not. */
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Number.isFinite(b) ? b : 0;
  }
  return a + (b - a) * (1 - Math.exp(-rate * dt));
};
