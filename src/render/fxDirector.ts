/**
 * fxDirector — the layer that decides WHEN the FX fire.
 *
 * It reads the Director and nothing else, and it does not write to it. Every
 * effect here is triggered by an OBSERVED transition: a man who was upright and
 * is now down, a bounce count that went up, a scrum stage that crossed into
 * ENGAGE, a banner that changed and says TRY. That is deliberate.
 *
 * The alternative — having `director.ts` call `fx.emit(...)` at each event —
 * would put particle bookkeeping inside the match engine, which is the exact
 * mistake §3.1 of the handoff warns about: three systems writing one player's
 * position in one frame. Here the engine owns the simulation, and this file
 * owns the interpretation of it, and neither can corrupt the other. It also
 * means the headless audit runs with zero FX overhead and unchanged numbers.
 *
 * Why the triggers are transitions rather than a request queue: the engine has
 * no event bus, and adding one to a 4 700-line state machine to service
 * decoration is a bad trade. Diffing eight scalars per frame is cheaper and
 * cannot drift out of sync, because there is no queue to overflow.
 *
 * The `pulse` output is the one number that flows the other way. A big hit at a
 * closing speed the design doc itself classifies as RUNNING (its
 * `hitKind` branch: "the dive; momentum carries the pair across the turf")
 * briefly steals time from `gameSpeed`. Not the engine's — the engine sees a
 * smaller dt, which it already clamps and multiplies by `gameSpeed` at
 * `director.ts:1318`. Nothing about a phase, a law or a stat changes, so the
 * audit stays green while the television picture gets a heartbeat.
 */
import type { Director } from '../game/director';
import type { ThreeParticles } from './ThreeParticles';
import type { ThreeEnvironment } from './ThreeEnvironment';
import type { Conditions } from './conditions';
import { RENDER_SCALE } from './retro';
import { KITS } from './ThreePlayerManager';

const S = RENDER_SCALE;

/** Turf colours by condition, kept near the renderer's own greens. */
const TURF_DRY = ['#4a7d3c', '#3f6c34'];
const TURF_WET = ['#2f5a2c', '#27491f'];
const MUD = ['#5b4227', '#472f1c'];
const FROST = ['#cfe0ee', '#a9c2d6'];

export interface FxPulse {
  /** 0..1 — how much of a breath the match has just taken. */
  impact: number;
  /** Camera shake to add on top of the engine's own. */
  shake: number;
}

export class FxDirector {
  /** Written by the view into `d.gameSpeed`; decays on its own. */
  pulse = 0;
  private prevDown: Uint8Array = new Uint8Array(0);
  /** Last frame's speed per man. A grounding zeroes velocity in the same
   *  frame it sets `down`, so the impact force has to be read from BEFORE the
   *  engine stops him — otherwise every tackle in the game measures as a
   *  stationary collapse and no hit ever throws turf. */
  private prevSpd: Float32Array = new Float32Array(0);
  private prevBounces = -1;
  private prevBannerAt = -1;
  private prevKickStage = '';
  private stepT: Float32Array = new Float32Array(0);
  private breathT: Float32Array = new Float32Array(0);
  private lastScrum = '';
  private lastRuck = -1;
  /** the ruck-churn emitter's own beat, so it does not fire every frame */
  private lastChurnStamp = -1;
  private lastMaul = '';
  private lastLoStage = '';
  private scored = false;

  constructor(
    private fx: ThreeParticles | null,
    private env: ThreeEnvironment | null,
  ) {}

  reset() {
    this.prevDown = new Uint8Array(0);
    this.prevBounces = -1;
    this.lastRuck = -1;
    this.scored = false;
    this.pulse = 0;
  }

  /** Ground-plane world position of a pitch coordinate. */
  private at(x: number, z: number, y = 0.0): [number, number, number] {
    return [x * S, y * S, -z * S];
  }

  private turfColors(cond: Conditions): [string, string] {
    if (cond.frost > 0.02) return FROST as [string, string];
    if (cond.mud > 0.5) return MUD as [string, string];
    return cond.wetness > 0.5 ? TURF_WET as [string, string] : TURF_DRY as [string, string];
  }

  update(d: Director, cond: Conditions, dt: number): FxPulse {
    const out: FxPulse = { impact: 0, shake: 0 };
    this.pulse = Math.max(0, this.pulse - dt * 2.4);
    const live = d.live;
    if (!live.length) return out;
    if (this.prevDown.length !== live.length) {
      this.prevDown = new Uint8Array(live.length);
      this.prevSpd = new Float32Array(live.length);
      this.stepT = new Float32Array(live.length);
      this.breathT = new Float32Array(live.length).map(() => Math.random() * 2.5);
    }
    const [ca, cb] = this.turfColors(cond);
    const firm = d.pitch.firm;

    /* -------------------------------------------------- 1. men hitting ground */
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      const down = p.down ? 1 : 0;
      const wasDown = this.prevDown[i];
      this.prevDown[i] = down;
      const spd = Math.hypot(p.vx, p.vz);
      const hitSpd = Math.max(spd, this.prevSpd[i]);
      this.prevSpd[i] = spd;

      if (down && !wasDown) {
        const [x, y, z] = this.at(p.x, p.z, 0.06);
        const burst = Math.random() * 6.283;
        const force = Math.min(1.7, 0.45 + hitSpd * 0.13);
        const dust = cond.dust * (1.25 - firm * 0.6);
        /* Amount scales with the closing speed, which is the same number that
         * made the engine choose the diving clip at all. */
        /* HALF the debris, and no restitution on soil. The old numbers — up to 34
         * clods thrown at 24 m/s with `bounce: firm*0.34` — came to rest in a ring
         * around every body that reached the deck, which at this resolution is
         * indistinguishable from what the user called blood puddles. Turf that
         * comes up at a tackle is thrown ONCE and gone. */
        const n = Math.round(4 + force * 8);
        const soil = cond.mud > 0.5;
        this.fx?.emit(soil ? 'MUD' : 'TURF', {
          count: n, x, y, z,
          /* Throw the debris the way he was going. `face` is a ±1 flag along z
           * (not an angle), so it is only usable as the fallback when the
           * velocity has already been zeroed by the same frame that put him
           * down. A stationary collapse gets a 360° burst instead. */
          dx: Math.abs(p.vx) > 0.05 ? p.vx * 0.55 : (spd > 0.2 ? p.vx * 0.2 : Math.cos(burst)),
          dz: Math.abs(p.vz) > 0.05 ? p.vz * 0.5 : (spd > 0.2 ? p.vz * 0.2 : Math.sin(burst)),
          speed: 5 + force * 11, up: 3.2 + force * 4.4,
          spread: 1.1 + force * 0.9, colorA: ca, colorB: cb,
          bounce: soil ? 0 : firm * 0.16, scale: 0.55 + p.size * 0.2,
        });
        if (dust > 0.16) {
          this.fx?.emit('DUST', {
            count: Math.round(4 + dust * 10), x, y: y + 0.1, z,
            dx: p.vx * 0.3, dz: p.vz * 0.3, speed: 2.4 + dust * 4, up: 2.2,
            spread: 1.6, colorA: '#b7a893', colorB: '#8f8471',
            opacity: 0.30 + dust * 0.28, scale: 1 + force * 0.5,
          });
        }
        if (cond.wetness > 0.55) {
          this.fx?.emit('WATER', {
            count: Math.round(5 + cond.wetness * 12), x, y, z,
            speed: 4, up: 4.6, spread: 1.3,
            colorA: '#dcecff', colorB: '#a8c4e4', opacity: 0.8,
          });
        }
        /* The turf remembers. A fended-off defender on a soft ground leaves a
         * scar that is still there at the final whistle. */
        this.env?.addScar(p.x, p.z, 0.35 + force * 0.75);
        if (force > 0.85) {
          out.impact = Math.max(out.impact, (force - 0.85) / 0.85);
          out.shake = Math.max(out.shake, 0.1 + force * 0.12);
          this.pulse = Math.max(this.pulse, Math.min(1, (force - 0.8) * 0.9));
        }
      }

      /* ------------------------------------------- 2. boots, breath, fatigue */
      const moving = spd > 5.4 && !down;
      this.stepT[i] -= dt;
      if (moving && this.stepT[i] <= 0) {
        this.stepT[i] = 0.34 - Math.min(0.18, spd * 0.018);
        const [x, , z] = this.at(p.x, p.z, 0.02);
        if (cond.dust > 0.1) {
          this.fx?.emit('DUST', {
            count: 2, x, y: 0.03 * S, z,
            dx: -p.vx * 0.5, dz: -p.vz * 0.5, speed: 1.5, up: 0.9,
            spread: 0.5, colorA: '#b2a48e', colorB: '#8d8271',
            opacity: 0.12 + cond.dust * 0.2,
          });
        }
        if (cond.wetness > 0.6) {
          this.fx?.emit('WATER', {
            count: 3, x, y: 0.04 * S, z,
            dx: -p.vx * 0.35, dz: -p.vz * 0.35, speed: 2.6, up: 2.2,
            spread: 0.45, colorA: '#d8e8fb', colorB: '#9fbde0', opacity: 0.55,
          });
        }
        if (cond.precip === 'SNOW') {
          this.fx?.emit('SNOWPUFF', {
            count: 2, x, y: 0.05 * S, z, dx: -p.vx * 0.3, dz: -p.vz * 0.3,
            speed: 1.8, up: 1.4, spread: 0.5, colorA: '#ffffff', colorB: '#dbe8f6',
            opacity: 0.75, bounce: 0,
          });
        }
      }

      if (cond.steam > 0.22 && !down) {
        this.breathT[i] -= dt;
        if (this.breathT[i] <= 0) {
          this.breathT[i] = 1.5 + Math.random() * 2.6 - Math.min(0.9, spd * 0.09);
          const [x, y, z] = this.at(p.x, p.z, 1.72 * p.size);
          const drift = 0.6 + Math.random() * 0.7;
          this.fx?.emit('STEAM', {
            count: 2, x: x + (p.face === 1 ? 0.4 : -0.4) * S, y, z,
            dx: cond.windX * drift, dz: cond.windZ * drift,
            speed: 1.1 + cond.windSpeed * 0.1, up: 1.5,
            spread: 0.3, colorA: '#e8f1fb', colorB: '#c9d8e8',
            opacity: 0.16 + cond.steam * 0.3,
          });
        }
      }
    }

    /* ------------------------------------------------------ 3. the ball down */
    if (d.kk) {
      const k = d.kk;
      if (this.prevKickStage !== 'FLIGHT' && k.stage === 'FLIGHT') {
        /* The strike. A punt takes a divot; a grubber scuffs the surface. */
        const [x, , z] = this.at(k.bx, k.bz, 0.03);
        const hard = k.profile.atGoal ? 0.55 : 1;
        this.fx?.emit(cond.mud > 0.5 ? 'MUD' : 'TURF', {
          count: Math.round(9 + 12 * hard), x, y: 0.04 * S, z,
          dx: Math.sin(k.dir) * 3, dz: Math.cos(k.dir) * 3,
          speed: 6 + k.power * 9 * hard, up: 2.6 + k.power * 3,
          spread: 0.8, colorA: ca, colorB: cb, bounce: firm * 0.3,
        });
        if (cond.wetness > 0.5) {
          this.fx?.emit('WATER', {
            count: 10, x, y: 0.05 * S, z, dx: Math.sin(k.dir) * 2, dz: Math.cos(k.dir) * 2,
            speed: 6, up: 3.4, spread: 0.9, colorA: '#e6f2ff', colorB: '#a9c6e6', opacity: 0.75,
          });
        }
        this.env?.addScar(k.bx, k.bz, 0.3 * hard);
        out.shake = Math.max(out.shake, 0.05 * hard);
      }
      this.prevKickStage = k.stage;
      if (k.bounces !== this.prevBounces && k.bounces > 0) {
        const [x, , z] = this.at(k.bx, k.bz, 0.04);
        const soft = cond.mud > 0.5 ? 0.35 : 1;
        this.fx?.emit(cond.wetness > 0.55 ? 'WATER' : 'DUST', {
          count: Math.round(5 + 6 * soft), x, y: 0.05 * S, z,
          speed: 3, up: 2.6, spread: 0.7,
          colorA: cond.wetness > 0.55 ? '#dcecff' : '#b6a892',
          colorB: cond.wetness > 0.55 ? '#a9c6e6' : '#8e8371',
          opacity: 0.5,
        });
        this.env?.addScar(k.bx, k.bz, 0.18 * soft);
      }
      this.prevBounces = k.bounces;
    }

    /* ------------------------------------------------- 4. the set-piece hits */
    if (d.scrim) {
      const st = d.scrim.stage;
      if (this.lastScrum !== 'ENGAGE' && st === 'ENGAGE') {
        const [x, , z] = this.at(d.scrumAnchor.x, d.scrumAnchor.z, 0.05);
        for (const side of [-1, 1]) {
          this.fx?.emit(cond.dust > 0.3 ? 'DUST' : 'TURF', {
            count: 16, x: x + side * 1.4 * S, y: 0.06 * S, z,
            dx: side * 0.6, dz: 0, speed: 7, up: 2.4, spread: 2.6,
            colorA: cond.dust > 0.3 ? '#b7a893' : ca, colorB: cond.dust > 0.3 ? '#8f8471' : cb,
            opacity: cond.dust > 0.3 ? 0.42 : 1,
          });
        }
        this.env?.addScar(d.scrumAnchor.x, d.scrumAnchor.z, 1.1);
        this.env?.addScar(d.scrumAnchor.x, d.scrumAnchor.z + 1.2, 0.8);
        out.impact = 1;
        out.shake = Math.max(out.shake, 0.3);
        this.pulse = 1;
        this.env?.cheerUp(0.28);
      }
      this.lastScrum = st;
    }

    if (d.bd) {
      const stamp = (d.t * 100) | 0;
      if (d.bd.stage === 'RUCK' && !d.bd.ruckFormed && this.lastRuck !== stamp) {
        this.lastRuck = stamp;
        const [x, , z] = this.at(d.bd.ball.placed ? d.bd.ball.x : d.bd.contactX, d.bd.ball.placed ? d.bd.ball.z : d.bd.contactZ, 0.05);
        this.fx?.emit(cond.mud > 0.5 ? 'MUD' : 'TURF', {
          count: 8, x, y: 0.05 * S, z, speed: 4, up: 3.2, spread: 1.8,
          colorA: ca, colorB: cb, bounce: cond.mud > 0.5 ? 0 : firm * 0.2,
        });
        this.env?.addScar(d.bd.contactX, d.bd.contactZ, 0.55);
      }
      /* T-41 — THE CHURN. A ruck is not one thud and then eight men standing
       * over it; it is boots going backwards into the same square metre for two
       * seconds. Three flecks every tenth of a second is nothing on a frame
       * budget and it is the single detail that makes a pile look CONTESTED
       * rather than posed, so it is worth the ten lines. */
      if (d.bd.stage === 'RUCK' || d.bd.stage === 'PLACE') {
        if (stamp !== this.lastChurnStamp && stamp % 6 === 0) {
          this.lastChurnStamp = stamp;
          const bx = d.bd.ball.placed ? d.bd.ball.x : d.bd.contactX;
          const bz = d.bd.ball.placed ? d.bd.ball.z : d.bd.contactZ;
          const [cx, , cz] = this.at(bx, bz, 0.02);
          const n = 2 + ((d.t * 7) | 0) % 2;
          for (let i = 0; i < n; i++) {
            const a = (i * 2.4 + d.t * 1.7) % 6.283;
            this.fx?.emit(cond.mud > 0.35 ? 'MUD' : 'DUST', {
              count: 1, x: cx + Math.cos(a) * 0.5 * S, y: 0.02 * S, z: cz + Math.sin(a) * 0.5 * S,
              dx: Math.cos(a) * 0.6, dz: Math.sin(a) * 0.6,
              speed: 1.4 + cond.mud * 1.6, up: 1.5, spread: 0.4,
              colorA: ca, colorB: cb, bounce: 0, scale: 0.5, opacity: 0.85,
            });
          }
        }
      }
    }

    if (d.ml) {
      const st = d.ml.stage;
      if ((this.lastMaul === 'ATTACK_CONTROL' || this.lastMaul === 'DEFENCE_HOLD')
        && (st === 'EXIT' || st === 'OVER')) {
        const [x, , z] = this.at(d.ml.x, d.ml.z, 0.05);
        this.fx?.emit('DUST', {
          count: 14, x, y: 0.06 * S, z, speed: 4, up: 2.2, spread: 2.4,
          colorA: '#b3a58f', colorB: '#8d8371', opacity: 0.3,
        });
        this.env?.addScar(d.ml.x, d.ml.z, 0.7);
      }
      this.lastMaul = st;
    }

    if (d.lo) {
      const st = d.lo.stage;
      if (this.lastLoStage !== 'CATCH' && st === 'CATCH') {
        /* The lift lands. Everyone in the row who is not holding the ball has
         * just come down off their toes. */
        const [x, , z] = this.at(d.lo.ball.x, d.lo.ball.z, 0.04);
        this.fx?.emit(cond.dust > 0.25 ? 'DUST' : 'TURF', {
          count: 8, x, y: 0.04 * S, z, speed: 3, up: 1.6, spread: 2.2,
          colorA: '#b3a58f', colorB: '#8d8371', opacity: 0.26,
        });
      }
      this.lastLoStage = st;
    }

    /* ------------------------------------------------------------ 5. the try */
    if (d.bannerAt !== this.prevBannerAt) {
      this.prevBannerAt = d.bannerAt;
      const b = (d.banner || '').toUpperCase();
      if (b.includes('TRY')) {
        const team = d.possession;
        const kit = team === 'A' ? KITS.A.jersey : KITS.B.jersey;
        const other = team === 'A' ? KITS.B.jersey : KITS.A.jersey;
        const z = 50 * (d.op?.dir ?? (team === 'A' ? 1 : -1));
        const [x, , zz] = this.at(0, z, 26);
        this.fx?.emit('CONFETTI', {
          count: 200, x, y: 26 * S, z: zz, speed: 9, up: -1.2, spread: 46,
          colorA: kit, colorB: other, opacity: 1, scale: 1.15,
        });
        /* Pyro at the base of each post, and the press gets its frame. */
        for (const px of [-2.8, 2.8]) {
          const [sx, , sz] = this.at(px, z, 0.4);
          this.fx?.emit('SPARK', {
            count: 60, x: sx, y: 0.5 * S, z: sz, speed: 12, up: 16, spread: 0.8,
            colorA: '#fff3c8', colorB: '#ffd27a',
          });
          this.fx?.emit('DUST', {
            count: 26, x: sx, y: 0.6 * S, z: sz, speed: 3, up: 6.5, spread: 1.2,
            colorA: '#cfd6de', colorB: '#9aa4b0', opacity: 0.4, scale: 2.4,
          });
        }
        this.env?.cameraFlashes(1);
        this.env?.cheerUp(1.0);
        this.scored = true;
        out.impact = 1;
        out.shake = Math.max(out.shake, 0.22);
      } else if (/(PENALTY|Advantage|NO GOOD)/i.test(b)) {
        this.env?.cameraFlashes(0.18);
      } else if (b.includes('YELLOW') || b.includes('RED')) {
        this.env?.cameraFlashes(0.55);
      }
    }
    if (this.scored && d.phase !== 'KICK') this.scored = false;

    /* ---------------------------------------------------- 6. the crowd noise */
    /* A line break and a score in the 22 both lift the bowl; the ad boards and
     * the flash field take that as their cue. Read-only on `d.op`. */
    if (d.phase === 'OPEN_PLAY' && d.op?.lineBreak) this.env?.cheerUp(0.5 * dt * 6);

    return out;
  }
}
