/**
 * pointerLock.ts — the browser half of the camera rig.
 *
 * Deliberately split from camera.ts. Everything here touches the DOM and can
 * therefore only run in a browser; everything in camera.ts is pure maths and
 * runs under vite-node in CI. Keeping the boundary sharp is what lets the rig
 * be tested at all.
 *
 * WHAT THIS OWNS
 *   - requesting and releasing pointer lock
 *   - accumulating mouse deltas between frames
 *   - rejecting the garbage deltas browsers emit around a lock transition
 */

export interface PointerLockOptions {
  /** Called when lock is gained or lost, for HUD prompts. */
  onChange?: (locked: boolean) => void;
}

export class PointerLock {
  private el: HTMLElement;
  private dx = 0;
  private dy = 0;
  private lockedFlag = false;
  private opts: PointerLockOptions;

  /* Cleanup handles. Without these, a hot reload leaves a second listener on
   * document and the view turns twice as fast — an obscure bug worth one
   * field of bookkeeping to make impossible. */
  private onMove: (e: MouseEvent) => void;
  private onLockChange: () => void;
  private onClick: () => void;

  constructor(el: HTMLElement, opts: PointerLockOptions = {}) {
    this.el = el;
    this.opts = opts;

    this.onMove = (e: MouseEvent) => {
      if (!this.lockedFlag) return;
      /* SPIKE REJECTION. Chrome and Safari can deliver one enormous delta on
       * the frame lock is acquired (the jump from the real cursor position to
       * the locked origin). Unfiltered, that snaps the view to a random angle
       * the instant the player clicks. Nothing produced by a human hand moves
       * 400 px in a single event at 60 Hz, so those are discarded. */
      const SPIKE = 400;
      const mx = e.movementX ?? 0;
      const my = e.movementY ?? 0;
      if (Math.abs(mx) > SPIKE || Math.abs(my) > SPIKE) return;
      this.dx += mx;
      this.dy += my;
    };

    this.onLockChange = () => {
      const locked = document.pointerLockElement === this.el;
      this.lockedFlag = locked;
      /* Drop anything buffered across the transition: those deltas belong to
       * a different frame of reference. */
      this.dx = 0; this.dy = 0;
      this.opts.onChange?.(locked);
    };

    this.onClick = () => { this.request(); };

    this.el.addEventListener('click', this.onClick);
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  /** Ask the browser for pointer lock. Safe to call when already locked. */
  request(): void {
    if (this.lockedFlag) return;
    /* Older Safari returns undefined rather than a promise, hence the guard.
     * A rejection here is normal — the browser refuses a lock that was not
     * driven by a user gesture — and must not surface as an unhandled
     * rejection in the console. */
    const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  release(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock?.();
  }

  get locked(): boolean { return this.lockedFlag; }

  /**
   * Take the accumulated movement and reset the accumulator.
   *
   * CONSUMING is the point: mouse events arrive at the device's rate, which
   * may be 125 Hz or 1000 Hz, while the rig runs per frame. Summing between
   * frames and draining once means sensitivity does not change with polling
   * rate, and no input is dropped on a slow frame.
   */
  consume(): { dx: number; dy: number } {
    const out = { dx: this.dx, dy: this.dy };
    this.dx = 0; this.dy = 0;
    return out;
  }

  dispose(): void {
    this.el.removeEventListener('click', this.onClick);
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.release();
  }
}
