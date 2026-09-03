/**
 * SPEC_05 / T-68 — AMBIENT SEED SEAM.
 *
 * `R()` (engine/rng.ts) is a module singleton that calls `Math.random()` at every
 * site in the wild. Replacing `R()` itself is therefore violently destructive, so
 * the determinism seam is AMBIENT: this module redefines `Math.random` (the only
 * thing `R()` reads) with a fixed-seed LCG for the whole process. Once seeded,
 * every downstream `R()` read is deterministic — two builds can be compared
 * match-for-match, which is the only way a gate harness means anything.
 *
 * Zero call-site churn: no `R()` invocation, argument, or signature is touched.
 * The harness owner simply calls `seedRng(n)` before the first frame and the
 * existing `R()` singleton obeys it invisibly.
 */

/** Deterministic LCG (same constants audit-cli used). Replaces Math.random. */
export function seedRng(seed: number): void {
  let s = seed >>> 0 || 1;
  Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
