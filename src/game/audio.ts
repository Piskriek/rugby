/**
 * T-10 — AUDIO. WebAudio, no assets.
 *
 * The entire atmosphere layer used to be a caption. Five layers now:
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
 *  4. TARCS BODY IMPACTS — `bodyImpact`, driven by the SOLVER rather than by
 *     the state machine. See the block comment above that method.
 *  5. SPATIALISATION — one-shots may be placed at a world point and are then
 *     panned and distance-attenuated against the camera. See `setListener`.
 *
 * Browser policy: the AudioContext is created (or resumed) only inside a user
 * gesture — `userGesture()` is called from the view's keydown handler, and
 * `armFirstGesture()` installs a capture-phase safety net for every other way
 * into the app. Until then every method is a no-op: no audio before the first
 * interaction, and headless harness runs stay silent.
 *
 * The CROWD NOISE option gates the whole layer: OFF is a full mute, LOW is
 * −7 dB on everything.
 */

/** A world point in PITCH coordinates (x across, y up, z downfield). */
export interface AudioPoint {
  x: number;
  y?: number;
  z: number;
}

/** What `bodyImpact` needs to know. Structurally the physics core's
 *  `PlayerImpact`, so a `RapierWorld` event can be forwarded verbatim. */
export interface ImpactCue {
  x: number;
  y?: number;
  z: number;
  /** |v_a − v_b| at contact, m/s. */
  relativeSpeed: number;
  /** Contact impulse magnitude, N·s. */
  impulse: number;
}

/**
 * Impulse (N·s) that maps to a full-scale hit. A 32 kg TABS trunk meeting
 * another head-on at 12 m/s has a reduced mass of 16 kg and delivers ~192 N·s,
 * so 220 puts the very hardest collision in the game just under the ceiling
 * and leaves everything else on a usable part of the curve.
 */
export const IMPACT_FULL_SCALE_IMPULSE = 220;

/** Speed at which a contact stops being a squeeze and starts being a hit. */
export const IMPACT_MIN_SPEED = 3.0;
/** Speed at which the slap/crunch layers are fully open. */
export const IMPACT_MAX_SPEED = 12.0;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

  /* ---- spatialisation + voice budget ---- */
  /** Where the listener is, in pitch coordinates. Panners are placed against
   *  this, so a hit on the far touchline arrives quiet and off to one side. */
  private listenerAt = { x: 0, y: 13, z: -18, yaw: 0, tilt: 0.55 };
  /** Impact voices started in the current budget window, and when it closes. */
  private voices = 0;
  private voiceWindowEnd = 0;
  /** Earliest ctx time at which another whistle may sound. Two subsystems can
   *  flag the same stoppage in one frame (the law call AND the ledger event);
   *  a referee only blows once. */
  private whistleUntil = 0;
  /** Cached soft-clip curve for the crunch layer. */
  private crunchCurve: Float32Array<ArrayBuffer> | null = null;
  /** Installed listeners from `armFirstGesture`, kept so we can remove them. */
  private gestureTeardown: (() => void) | null = null;

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
        this.applyListener();
      } catch {
        this.ctx = null; // no audio then — the game does not care
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    /* Once we are actually running the safety-net listeners are dead weight. */
    if (this.ctx.state === 'running') this.disarmFirstGesture();
  }

  /**
   * BROWSER AUTOPLAY POLICY, belt and braces.
   *
   * `userGesture()` is wired to the match view's own keydown/mousedown, but the
   * player can reach a live pitch by a route that never fires either (a touch
   * on a menu button, a gamepad-driven start, a click on the HUD). Chrome and
   * Safari both require the context be created or resumed INSIDE the gesture
   * task, so a poll or a timeout is useless — the resume has to happen on the
   * event itself.
   *
   * This installs capture-phase listeners for every gesture type the autoplay
   * spec recognises. They remove themselves the moment the context is running,
   * so the steady-state cost is zero.
   */
  armFirstGesture(target: EventTarget | null = (globalThis as any).window ?? null) {
    if (!target || this.gestureTeardown) return;
    if (this.ctx && this.ctx.state === 'running') return;
    const kinds = ['pointerdown', 'mousedown', 'touchstart', 'touchend', 'keydown'] as const;
    const onGesture = () => this.userGesture();
    for (const k of kinds) target.addEventListener(k, onGesture, { capture: true, passive: true });
    this.gestureTeardown = () => {
      for (const k of kinds) target.removeEventListener(k, onGesture, { capture: true });
      this.gestureTeardown = null;
    };
  }

  /** Drop the autoplay safety net. Called automatically once audio runs. */
  disarmFirstGesture() {
    this.gestureTeardown?.();
  }

  /** True once the context exists AND is running — i.e. a gesture has landed. */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Release the context. Safe to call on an un-started engine. */
  dispose() {
    this.disarmFirstGesture();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.bedGain = null;
    this.bedFilter = null;
    this.rainGain = null;
    this.rainFilter = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
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

  /* ---------- spatialisation ---------- */

  /**
   * THE EARS. Placed on the camera, in pitch coordinates.
   *
   * Pitch space is (x across, y up, z downfield) and its ground-forward for a
   * given yaw is (sin yaw, cos yaw) — the same convention `ThreeCanvas` uses to
   * build the render camera. That triple is right-handed exactly like WebAudio's
   * own coordinate system, so listener and sources can both be fed raw pitch
   * metres and the geometry between them comes out correct with no remapping.
   *
   * Call it once a frame from the director. Cheap: five AudioParam writes.
   */
  setListener(x: number, y: number, z: number, yaw: number, tilt = 0) {
    this.listenerAt = { x, y, z, yaw, tilt };
    this.applyListener();
  }

  private applyListener() {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const { x, y, z, yaw, tilt } = this.listenerAt;
    /* Tilt is a DOWNWARD pitch of the lens, hence the negative y on forward. */
    const ct = Math.cos(tilt);
    const fx = Math.sin(yaw) * ct;
    const fy = -Math.sin(tilt);
    const fz = Math.cos(yaw) * ct;
    /* Up is world-up rotated forward by the tilt, so it stays perpendicular. */
    const st = Math.sin(tilt);
    const ux = Math.sin(yaw) * st;
    const uy = ct;
    const uz = Math.cos(yaw) * st;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(x, t);
      L.positionY.setValueAtTime(y, t);
      L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t);
      L.forwardY.setValueAtTime(fy, t);
      L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux, t);
      L.upY.setValueAtTime(uy, t);
      L.upZ.setValueAtTime(uz, t);
    } else {
      /* Safari < 14 and friends. Deprecated, but the only API they have. */
      (L as any).setPosition?.(x, y, z);
      (L as any).setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
  }

  /**
   * The node a one-shot should connect to.
   *
   * With no world point it is the master bus, exactly as before — the crowd,
   * the whistle and every legacy caller are unmoved. With a point it is a
   * PannerNode placed there: `inverse` rolloff with a generous 12 m reference
   * distance, because a rugby pitch is 100 m long and a linear model makes
   * everything past the 22 inaudible. `equalpower` rather than HRTF: this fires
   * on every collision in a ruck and HRTF convolution per voice is not worth
   * the CPU for a sound that lasts 90 ms.
   */
  private sink(at?: AudioPoint | null): AudioNode | null {
    if (!this.ctx || !this.master) return null;
    if (!at) return this.master;
    try {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 12;
      p.maxDistance = 120;
      p.rolloffFactor = 0.9;
      const x = at.x;
      const y = at.y ?? 1;
      const z = at.z;
      if (p.positionX) {
        const t = this.ctx.currentTime;
        p.positionX.setValueAtTime(x, t);
        p.positionY.setValueAtTime(y, t);
        p.positionZ.setValueAtTime(z, t);
      } else {
        (p as any).setPosition?.(x, y, z);
      }
      p.connect(this.master);
      return p;
    } catch {
      return this.master;
    }
  }

  /**
   * VOICE BUDGET. A twelve-man ruck can hand us a dozen qualifying contacts in
   * the same 16 ms. Past about six simultaneous impact voices the result is
   * mud, not violence, and the oscillator churn shows up on a frame graph — so
   * the budget refuses the overflow rather than letting the mix collapse.
   */
  private takeVoice(max = 6, window = 0.1): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (now >= this.voiceWindowEnd) {
      this.voiceWindowEnd = now + window;
      this.voices = 0;
    }
    if (this.voices >= max) return false;
    this.voices++;
    return true;
  }

  /** Soft-clip transfer curve for the crunch layer, built once. */
  private softClip(): Float32Array<ArrayBuffer> {
    if (this.crunchCurve) return this.crunchCurve;
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    this.crunchCurve = curve;
    return curve;
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

  /**
   * The director drains `frameEvents` into here once a frame.
   *
   * TARCS — the breakdown ledger's two verdicts now reach the referee. A
   * TURNOVER and a SCRUM_PEN were both silent before: the ledger recorded them,
   * the commentary called them, and the only stoppage the player could HEAR was
   * whatever `lawCall` happened to blow for. A penalty gets the long blast; a
   * turnover gets the short one, because it is a change of hands rather than a
   * full stoppage and using the same sound for both teaches the player nothing.
   *
   * Double-blast protection lives in `whistle()`, so a SCRUM_PEN arriving in
   * the same frame as the `lawCall` that produced it collapses to one call.
   */
  event(type: string, force = 0.5, at?: AudioPoint | null) {
    if (this.level === 0) return;
    if (type === 'TACKLE') this.impact(0.35 + force * 0.65, at);
    else if (type === 'KICK') this.impact(0.4, at);
    else if (type === 'LINE_BREAK') this.spike = Math.min(0.24, this.spike + 0.2);
    /* D-5 — the try spike drove the bed to -4.7 dBFS which, summed with the
     * boosted whistle and a simultaneous tackle, left only 0.2 dB of headroom
     * against a chain that has NO limiter. Trimmed to 0.24: the try is still
     * by far the loudest the crowd gets, with room for the whistle over it. */
    else if (type === 'TRY') { this.spike = 0.24; this.whistle('DOUBLE'); this.roar(); }
    else if (type === 'CARD') this.whistle('LONG');
    /* TARCS — the breakdown ledger. */
    else if (type === 'SCRUM_PEN') this.whistle('LONG');
    else if (type === 'TURNOVER') this.whistle('SHORT');
    /* T-40 — a cleanout is a lower, duller sound than a tackle: body into a
     * body that is braced for it, at the ground rather than at the chest. */
    else if (type === 'CLEANOUT') this.impact(0.28 + force * 0.3, at);
  }

  /* ---------- one-shots ---------- */

  /** A collision: noise burst, cutoff and length by force (0..1). */
  impact(force: number, at?: AudioPoint | null) {
    if (!this.ctx || !this.master) return;
    const out = this.sink(at);
    if (!out) return;
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
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.25);
  }

  /**
   * TARCS — THE BONE-CRUNCHING HIT.
   *
   * `impact()` above is a state-machine cue: the director decided a tackle
   * happened and picked a 0..1 number for it. This one is driven by the SOLVER
   * — `RapierWorld` measures the closing speed and the contact impulse of two
   * player colliders and hands them over unedited. Two men jogging into each
   * other and two men meeting at 11 m/s are the same *event* to the director
   * and completely different *sounds* here, which is the whole point.
   *
   * Three layers, each gated by a different property of the collision, because
   * a real collision is not one sound:
   *
   *   BODY   — a pitched sine thumping down towards 45 Hz. This is mass moving.
   *            It is present at every qualifying impact and it carries the
   *            weight. Scaled by IMPULSE.
   *   SLAP   — a short band-passed noise crack: kit, skin, shoulder. Scaled by
   *            SPEED, not impulse. A slow shove has no slap in it however heavy
   *            the men are, which is exactly why the two inputs stay separate.
   *   CRUNCH — noise driven through a tanh soft-clip and a high shelf, only
   *            above ~65% of full scale. This is the goofy TABS grit, and
   *            rationing it is what keeps it funny instead of constant.
   *
   * PITCH scales INVERSELY with impulse: a big hit is a low, slow, long sound
   * and a glancing one is a high, short tick. That is both physically right
   * (more mass, lower resonant frequency) and the convention every impact
   * library follows, so it reads correctly without being taught.
   *
   * The peak stays under the whistle. D-5 ruled the referee is the loudest
   * thing on the pitch and a hit that buries the call is a bug, not a feature.
   */
  bodyImpact(cue: ImpactCue) {
    if (this.level === 0 || !this.ctx || !this.master) return;
    if (cue.relativeSpeed <= IMPACT_MIN_SPEED) return;
    if (!this.takeVoice()) return;

    const out = this.sink({ x: cue.x, y: cue.y ?? 1, z: cue.z });
    if (!out) return;

    /* The two independent drivers. */
    const force = clamp01(cue.impulse / IMPACT_FULL_SCALE_IMPULSE);
    const speed = clamp01(
      (cue.relativeSpeed - IMPACT_MIN_SPEED) / (IMPACT_MAX_SPEED - IMPACT_MIN_SPEED),
    );
    /* LOW gets everything at -7 dB, same rule as the bed. */
    const gate = this.level === 1 ? 0.45 : 1;
    /* Bigger hit, lower voice. 1.35x at a graze down to 0.72x at full scale. */
    const pitch = 1.35 - force * 0.63;
    const t = this.ctx.currentTime;

    /* ---- BODY: the mass ---- */
    {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const f0 = 165 * pitch;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(38, f0 * 0.28), t + 0.11 + force * 0.09);
      const g = this.ctx.createGain();
      const peak = (0.035 + force * 0.095) * gate;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13 + force * 0.16);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.34 + force * 0.16);
    }

    /* ---- SLAP: kit and skin. Speed-gated, surface-coloured. ---- */
    if (speed > 0.02) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer(0.12);
      if (src.buffer) {
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 0.9;
        /* Firm ground and a fast hit crack high; a mudbath swallows the top. */
        bp.frequency.setValueAtTime(
          (900 + speed * 1700) * (0.6 + this.surface * 0.5),
          t,
        );
        bp.frequency.exponentialRampToValueAtTime(
          (420 + speed * 500) * (0.6 + this.surface * 0.5),
          t + 0.07,
        );
        const g = this.ctx.createGain();
        const peak = (0.02 + speed * 0.07) * (0.45 + force * 0.55) * gate;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + speed * 0.05);
        src.connect(bp).connect(g).connect(out);
        src.start(t);
        src.stop(t + 0.14);
      }
    }

    /* ---- CRUNCH: the TABS grit. Rationed to the genuinely big ones. ---- */
    if (force > 0.65) {
      const bite = (force - 0.65) / 0.35;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer(0.1);
      if (src.buffer) {
        src.playbackRate.value = 0.5 + bite * 0.5; // grain size = grit size
        const shaper = this.ctx.createWaveShaper();
        shaper.curve = this.softClip();
        shaper.oversample = '2x';
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1400;
        const g = this.ctx.createGain();
        const peak = 0.045 * bite * gate;
        g.gain.setValueAtTime(0.0001, t + 0.004);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
        src.connect(shaper).connect(hp).connect(g).connect(out);
        src.start(t);
        src.stop(t + 0.12);
      }
    }
  }

  /** The referee: two detuned squares with a downward bend.
   * LONG is the law award; DOUBLE is the try; SPEC_08's SHORT is the single
   * sharp blast that marks a persistent call engaging (USE IT at a stalled
   * maul) — one cue, fired when the call goes live. */
  whistle(kind: 'LONG' | 'DOUBLE' | 'SHORT', at?: AudioPoint | null) {
    if (!this.ctx || !this.master) return;
    /* ONE REFEREE, ONE WHISTLE. A stoppage can be flagged twice in the same
     * frame — `lawCall` blows for the penalty and the breakdown ledger emits
     * the matching event — and two overlapping blasts sound like two officials.
     * The first caller wins; anything inside the guard window is dropped. */
    const now = this.ctx.currentTime;
    if (now < this.whistleUntil) return;
    const total = kind === 'LONG' ? 0.55 : kind === 'SHORT' ? 0.22 : 0.4;
    this.whistleUntil = now + total + 0.12;
    const out = this.sink(at);
    if (!out) return;
    const blast = (at2: number, dur: number) => {
      const t = this.ctx!.currentTime + at2;
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
      g.connect(out);
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

/**
 * THE BRIDGE — physics core to audio engine.
 *
 * `RapierWorld` reports player-vs-player impacts through a plain listener
 * callback and knows nothing about audio; `MatchAudio` synthesises hits and
 * knows nothing about Rapier. This is the one function that introduces them,
 * and it is deliberately the only place the two names appear together.
 *
 * The world parameter is typed STRUCTURALLY rather than as `RapierWorld`, so
 * this module never imports the physics core — not even as a type. That keeps
 * the ~1 MB rapier WASM chunk out of the audio bundle and keeps `audio.ts`
 * importable from a headless context that has no physics at all.
 *
 * ```ts
 * const detach = attachImpactAudio(world, director.audio);
 * ```
 *
 * @returns an unsubscribe function. Call it when the world is disposed.
 */
export function attachImpactAudio(
  world: { onPlayerImpact(listener: (impact: ImpactCue) => void): () => void },
  audio: MatchAudio,
): () => void {
  return world.onPlayerImpact((impact) => audio.bodyImpact(impact));
}
