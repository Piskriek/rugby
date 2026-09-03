/**
 * T-10 — AUDIO. WebAudio, no assets.
 *
 * The entire atmosphere layer used to be a caption. Three layers now:
 *
 *  1. CROWD BED — a looped noise buffer through a lowpass. Amplitude is
 *     driven by `momentum` and field position (the crowd swells inside the
 *     attacking 22) and mixed by the travelling-support ratio of the two
 *     sides. The filter opens as the crowd gets louder — a stadium brightens,
 *     it does not just get louder.
 *  2. IMPACTS — short noise bursts, cutoff and length pitched by force.
 *     Tackles, the kick off the boot.
 *  3. WHISTLE — two detuned square oscillators with a slight downward bend.
 *     Law calls get a long blast; a try gets the short-double.
 *
 * Browser policy: the AudioContext is created (or resumed) only inside a user
 * gesture — `userGesture()` is called from the view's keydown handler. Until
 * then every method is a no-op: no audio before the first interaction, and
 * headless harness runs stay silent.
 *
 * The CROWD NOISE option gates the whole layer: OFF is a full mute, LOW is
 * −7 dB on everything.
 */

export class MatchAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bedGain: GainNode | null = null;
  private bedFilter: BiquadFilterNode | null = null;
  /** eased bed amplitude 0..~0.3 */
  private swell = 0;
  /** one-shot swell added by breaks and tries, decays over ~1.5 s */
  private spike = 0;
  /** 0 = muted, 1 = low, 2 = full (the CROWD NOISE option) */
  level = 2;

  /* ---------- lifecycle ---------- */

  /** Call from a real user gesture (keydown). Safe to call repeatedly. */
  userGesture() {
    const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      try {
        this.ctx = new AC() as AudioContext;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
        this.startBed();
      } catch {
        this.ctx = null; // no audio then — the game does not care
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private noiseBuffer(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startBed() {
    if (!this.ctx || !this.master) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2.5);
    if (!src.buffer) return;
    src.loop = true;
    this.bedFilter = this.ctx.createBiquadFilter();
    this.bedFilter.type = 'lowpass';
    this.bedFilter.frequency.value = 640;
    this.bedFilter.Q.value = 0.35;
    this.bedGain = this.ctx.createGain();
    this.bedGain.gain.value = 0;
    src.connect(this.bedFilter).connect(this.bedGain).connect(this.master);
    src.start();
  }

  /* ---------- per frame ---------- */

  /**
   * @param momentum   −1..1 — the crowd follows the swing of the game
   * @param in22       the ball is inside an attacking 22 — the swell rises
   * @param crowdRatio mean travelling support of the two sides, 0..1
   */
  update(dt: number, momentum: number, in22: boolean, crowdRatio: number) {
    if (!this.bedGain || !this.bedFilter) return;
    const gate = this.level === 0 ? 0 : this.level === 1 ? 0.45 : 1;
    const target = this.level === 0 ? 0
      : (0.05 + Math.abs(momentum) * 0.055 + (in22 ? 0.08 : 0) + this.spike) * gate;
    this.spike = Math.max(0, this.spike - dt * 0.2);
    this.swell += (target - this.swell) * Math.min(1, dt * 1.7);
    this.bedGain.gain.value = this.swell * (0.55 + crowdRatio * 0.55);
    // a stadium brightens as it gets louder
    this.bedFilter.frequency.value = 600 + this.swell * 1100;
  }

  /* ---------- events (the T-08 bus) ---------- */

  event(type: string, force = 0.5) {
    if (this.level === 0) return;
    if (type === 'TACKLE') this.impact(0.35 + force * 0.65);
    else if (type === 'KICK') this.impact(0.4);
    else if (type === 'LINE_BREAK') this.spike = Math.min(0.24, this.spike + 0.2);
    else if (type === 'TRY') { this.spike = 0.34; this.whistle('DOUBLE'); }
    else if (type === 'CARD') this.whistle('LONG');
  }

  /* ---------- one-shots ---------- */

  /** A collision: noise burst, cutoff and length by force (0..1). */
  impact(force: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.22);
    if (!src.buffer) return;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260 + force * 860;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * force + 0.03, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + force * 0.07);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.25);
  }

  /** The referee: two detuned squares with a downward bend.
   * LONG is the law award; DOUBLE is the try; SPEC_08's SHORT is the single
   * sharp blast that marks a persistent call engaging (USE IT at a stalled
   * maul) — one cue, fired when the call goes live. */
  whistle(kind: 'LONG' | 'DOUBLE' | 'SHORT') {
    if (!this.ctx || !this.master) return;
    const blast = (at: number, dur: number) => {
      const t = this.ctx!.currentTime + at;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.085, t + 0.012);
      g.gain.setValueAtTime(0.085, t + dur - 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(this.master!);
      for (const f of [2093, 2333]) {
        const o = this.ctx!.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.94, t + dur); // the bend
        const og = this.ctx!.createGain();
        og.gain.value = f > 2200 ? 0.5 : 1; // the detune sits under
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
    };
    if (kind === 'LONG') blast(0, 0.55);
    else if (kind === 'SHORT') blast(0, 0.22);
    else { blast(0, 0.16); blast(0.24, 0.16); }
  }
}
