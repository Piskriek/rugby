/**
 * OPTIONAL SPOKEN COMMENTARY — the COMMENTARY option's VOICE tier.
 *
 * The commentary bank has always been a two-line caption (the McLaren and
 * Beaumont register). This module lets the same lines be read ALOUD through
 * the browser's built-in SpeechSynthesis API: zero assets, zero network,
 * zero engine changes. It lives entirely on the view layer — the engine
 * keeps writing `d.feed` exactly as before, and this module listens.
 *
 * Rules it obeys:
 *   - VOICE is opt-in. The default COMMENTARY tier stays FULL (captions).
 *   - It never speaks in a headless harness: if `speechSynthesis` is absent
 *     every method is a no-op, so the capture bots stay silent.
 *   - It reuses the commentary bank's own de-duplication discipline (the
 *     engine already rate-limits lines); on top of that it refuses to speak
 *     the same line twice in a row and yields the newest comment immediately
 *     (new line interrupts the one still speaking, like a real broadcast).
 *   - The voice is picked per utterance (the voice list loads async), biased
 *     toward an en-GB register so the two-hander keeps its accent.
 */
export class CommentarySpeech {
  /** 0 = off, 1 = on. Set from `options.commentary` each frame. */
  level = 0;

  private queue: string[] = [];
  private speaking = false;
  private lastKey = '';
  private flushTimer: number | null = null;

  private get synth(): SpeechSynthesis | null {
    if (typeof window === 'undefined') return null;
    if (!('speechSynthesis' in window)) return null;
    return window.speechSynthesis;
  }

  /** Call from a real user gesture (keydown) so the voice list is warm by
   * the time the first line fires. Safe to call repeatedly. */
  userGesture() {
    try { this.synth?.getVoices(); } catch { /* no-op */ }
  }

  /** Speak a commentary pair (primary line, optional co-commentator quip). */
  speak(text: string, text2?: string) {
    const s = this.synth;
    if (!s || this.level === 0) return;
    const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
    const lines: string[] = [];
    const a = clean(text);
    if (a) lines.push(a);
    const b = clean(text2 ?? '');
    if (b && b !== a) lines.push(b);
    if (!lines.length) return;
    const key = lines.join(' | ');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.queue = lines;
    this.flush();
  }

  /** Stop the current line and drop everything queued. */
  mute() {
    if (this.flushTimer !== null) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    try { this.synth?.cancel(); } catch { /* no-op */ }
    this.queue = [];
    this.speaking = false;
  }

  private flush() {
    const s = this.synth;
    if (!s) return;
    try { s.cancel(); } catch { /* no-op */ }
    this.speaking = false;
    /* Chrome drops an utterance spoken in the same tick as cancel(); yield a
     * beat before starting the new line. */
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => { this.flushTimer = null; this.start(); }, 60);
  }

  private start() {
    const s = this.synth;
    if (!s || this.speaking || !this.queue.length) return;
    const text = this.queue.shift()!;
    this.speaking = true;
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice();
    if (v) u.voice = v;
    u.rate = 1.02;
    u.pitch = 0.94;
    u.volume = 0.9;
    const done = () => {
      this.speaking = false;
      if (this.queue.length) this.start();
    };
    u.onend = done;
    u.onerror = done;
    try { s.speak(u); } catch { done(); }
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const s = this.synth;
    if (!s) return null;
    const voices = s.getVoices();
    if (!voices.length) return null;
    const score = (v: SpeechSynthesisVoice) => {
      const name = v.name.toLowerCase();
      const lang = (v.lang ?? '').toLowerCase();
      let sc = 0;
      if (lang === 'en-gb') sc += 8;            // the McLaren register
      else if (lang.startsWith('en')) sc += 4;
      else if (lang) sc -= 2;                    // prefer English at all
      if (/male|daniel|arthur|george|james|ryan|graham|william|oliver/i.test(name)) sc += 2;
      if (/female|samantha|karen|moira|tessa|victoria|hazel|sonia/i.test(name)) sc -= 3;
      if (v.localService) sc += 1;
      if (v.default) sc += 1;
      return sc;
    };
    return voices.slice().sort((a, b) => score(b) - score(a))[0] ?? voices[0];
  }
}
