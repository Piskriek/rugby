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
  /** THE WEATHER BED. Rain is not loud, it is everywhere: a band of hiss
   *  sitting ABOVE the crowd in spectrum (1.4–3.4 kHz) so it never muddies the
   *  roar, gated by the same CROWD NOISE level so OFF means OFF. */
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  /** presentation-side inputs, applied in update() */
  private rainWant = 0;
  private windWant = 0;
  /** 0 = mud, 1 = firm. Reshapes an impact: a dry-slap or a dull thud. */
  private surface = 0.7;
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
    this.startRain();
  }

  /**
   * The rain bed. A second looping noise source, band-passed and deliberately
   * quiet: the design doc's mix ruling (D-5) established that the WHISTLE is
   * the peak of this mix at -11.4 dBFS and the tackle sits at -19.0, so weather
   * has to live under both. 0.045 gain peaks near -27 dBFS: audible on a
   * headset, never loud enough to hide a call.
   */
  private startRain() {
    if (!this.ctx || !this.master) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(3.1);
    if (!src.buffer) return;
    src.loop = true;
    this.rainFilter = this.ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.frequency.value = 2200;
    this.rainFilter.Q.value = 0.6;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    src.connect(this.rainFilter).connect(this.rainGain).connect(this.master);
    src.start();
  }

  /** Called by the view from the resolved conditions. Presentation only — the
   *  engine's own wetness numbers are untouched by this. */
  setWeather(rainLevel: number, windSpeed: number) {
    this.rainWant = Math.max(0, Math.min(1, rainLevel));
    this.windWant = Math.max(0, Math.min(1, windSpeed / 18));
  }

  /** 0 = a mud bath, 1 = a hard firm. See `impact`. */
  setSurface(firmness: number) {
    this.surface = Math.max(0, Math.min(1, firmness));
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
    /* D-5 — the quiet bed floor was 0.05 => -32.1 dBFS at master with no
     * travelling support, effectively inaudible on normal playback. Raised to
     * 0.11 (-25.2 dBFS) so an idle stadium is present without crowding the
     * one-shots. The momentum/22 terms are unchanged, so the SHAPE of the
     * swell is preserved; only the floor moves. */
    const target = this.level === 0 ? 0
      : (0.11 + Math.abs(momentum) * 0.055 + (in22 ? 0.08 : 0) + this.spike) * gate;
    this.spike = Math.max(0, this.spike - dt * 0.2);
    this.swell += (target - this.swell) * Math.min(1, dt * 1.7);
    this.bedGain.gain.value = this.swell * (0.55 + crowdRatio * 0.55);
    // a stadium brightens as it gets louder
    this.bedFilter.frequency.value = 600 + this.swell * 1100;

    /* Weather follows the crowd rather than overriding it: the rain ducks a
     * little when the bowl roars, because 50 000 people shouting IS louder than
     * the weather, and a mix that forgets that sounds like a screensaver. */
    if (this.rainGain && this.rainFilter) {
      const gust = 0.75 + 0.25 * Math.sin(this.swellT * 0.9) * (0.4 + this.windWant);
      const target = this.level === 0 ? 0 : this.rainWant * 0.045 * gate * gust
        * (1 - Math.min(0.45, this.swell * 1.2));
      this.rainGain.gain.value += (target - this.rainGain.gain.value) * Math.min(1, dt * 2.2);
      this.rainFilter.frequency.value = 1400 + this.rainWant * 1200 + this.windWant * 700;
      this.rainFilter.Q.value = 0.6 + this.windWant * 0.5;
    }
    this.swellT += dt;
  }
  private swellT = 0;

  /* ---------- events (the T-08 bus) ---------- */

  event(type: string, force = 0.5) {
    if (this.level === 0) return;
    if (type === 'TACKLE') this.impact(0.35 + force * 0.65);
    else if (type === 'KICK') this.impact(0.4);
    else if (type === 'LINE_BREAK') this.spike = Math.min(0.24, this.spike + 0.2);
    /* D-5 — the try spike drove the bed to -4.7 dBFS which, summed with the
     * boosted whistle and a simultaneous tackle, left only 0.2 dB of headroom
     * against a chain that has NO limiter. Trimmed to 0.24: the try is still
     * by far the loudest the crowd gets, with room for the whistle over it. */
    else if (type === 'TRY') { this.spike = 0.24; this.whistle('DOUBLE'); this.roar(); }
    else if (type === 'CARD') this.whistle('LONG');
    /* T-40 — a cleanout is a lower, duller sound than a tackle: body into a
     * body that is braced for it, at the ground rather than at the chest. */
    else if (type === 'CLEANOUT') this.impact(0.28 + force * 0.3);
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
    /* A tackle on a FIRM pitch is a slap through the shoulder; on MUDDY ground
     * the pitch is absorbed and the contact is a low, dead thud. Same event,
     * different filter — the cheapest realism available in a synthesiser. */
    lp.frequency.value = (260 + force * 860) * (0.55 + this.surface * 0.55);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    /* D-5 — SUBTRACTIVE MIX. Impacts were the loudest one-shot in the game at
     * -13.0 dBFS, 5.8 dB ABOVE the referee's whistle. Attenuated to free the
     * headroom the whistle boost needs; the whistle is now the peak, as it
     * should be on a rugby pitch. */
    g.gain.exponentialRampToValueAtTime(0.125 * force + 0.02, t + 0.005);
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
      /* D-5 — the whistle is the highest peak in the mix (ruled). Note the
       * envelope is NOT the true peak: two detuned squares sum through this
       * one gain at og 1.0 and 0.5, so the real peak is up to 1.5x. 0.20
       * envelope => 0.30 summed => 0.27 at master = -11.4 dBFS, comfortably
       * above the attenuated tackle at -19.0 dBFS. */
      g.gain.exponentialRampToValueAtTime(0.20, t + 0.012);
      g.gain.setValueAtTime(0.20, t + dur - 0.03);
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

  /**
   * THE ROAR. A try already gets the bed spike and the double whistle; what it
   * has never had is the stadium arriving a beat LATE, which is the actual
   * shape of a crowd reaction — 0.35 s of swell, 2.4 s of decay, and a band
   * that opens as it peaks. Kept at 0.13 so it stays under the whistle's
   * ruled-peak and above the rain.
   */
  roar() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(3.2);
    if (!src.buffer) return;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
    bp.frequency.exponentialRampToValueAtTime(520, t + 2.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 3.1);
  }

  /**
   * RC2-4 — THE REFEREE'S VOICE, not his whistle.
   *
   * A whistle means STOP. Using one for a live-play management call ("no more
   * hands", "use it") teaches the player to freeze when the referee actually
   * wants him to keep going, which is what broke immersion in QA. On a real
   * pitch these are shouted, so this is a shout: a short filtered noise burst
   * with a falling formant — a vocal bark rather than a tone, deliberately
   * unlike the 2093/2333 Hz whistle so the two can never be confused.
   *
   * Level sits BELOW the whistle by design (D-5 ruled the whistle is the peak
   * of the mix): ~0.085 against the whistle's 0.20 envelope, so it reads as
   * the referee raising his voice over the noise, not as a stoppage.
   */
  shout() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.3);
    if (!src.buffer) return;
    /* Band-pass around the human vocal range, sweeping down — the contour of a
     * barked syllable. A whistle is a steady high tone; this is neither. */
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4.5;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.32);
  }
}
