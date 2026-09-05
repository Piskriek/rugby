/**
 * Pooled uniform-grid spatial index. The whole match is 31 entities, but the
 * engine queries neighbourhoods every frame (tackle range, pass options,
 * collision separation, ruck/maul formation). A hash grid turns those from
 * O(n²) scans into constant-ish lookups with zero per-frame allocation.
 */
const CELL = 5; // metres per cell — a little over a tackle range

export class SpatialGrid {
  private cells = new Map<number, number[]>(); // key → entity ids
  private xs: number[] = [];
  private ys: number[] = [];

  /** (Re)build the index. Call once per frame. */
  build(xs: number[], ys: number[]): void {
    this.xs = xs;
    this.ys = ys;
    this.cells.clear();
    for (let i = 0; i < xs.length; i++) {
      const key = this.keyOf(xs[i], ys[i]);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private keyOf(x: number, y: number): number {
    const cx = Math.floor((x + 100) / CELL);
    const cy = Math.floor((y + 100) / CELL);
    return cx * 4096 + cy;
  }

  /**
   * Collect entity ids within `radius` metres of (x, y) into `out`
   * (cleared first). Returns the same array — no allocation.
   */
  query(x: number, y: number, radius: number, out: number[]): number[] {
    out.length = 0;
    const r2 = radius * radius;
    const cmin = Math.floor((x + 100 - radius) / CELL);
    const cmax = Math.floor((x + 100 + radius) / CELL);
    const rmin = Math.floor((y + 100 - radius) / CELL);
    const rmax = Math.floor((y + 100 + radius) / CELL);
    for (let cx = cmin; cx <= cmax; cx++) {
      for (let cy = rmin; cy <= rmax; cy++) {
        const bucket = this.cells.get(cx * 4096 + cy);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const id = bucket[k];
          const dx = this.xs[id] - x;
          const dy = this.ys[id] - y;
          if (dx * dx + dy * dy <= r2) out.push(id);
        }
      }
    }
    return out;
  }
}
