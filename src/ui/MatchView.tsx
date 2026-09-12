import { useEffect, useRef, useState } from 'react';
import { Director, Input, NO_INPUT, MatchConfig } from '../game/director';
import { sinBinClock, strengthText } from '../game/atmosphere';
import { drawMatch, drawWipe } from '../render/scene';
import { drawFacingStrafeOverlay } from '../render/facingDebug';
import { drawMinimap } from '../render/minimap';
import {
  DEFAULT_TUNING, createRigState, toggleViewMode, updateRig,
  type RigInput,
} from '../render/camera';
import { PointerLock } from '../render/pointerLock';
import TARCSHud from './TARCSHud';
import {
  RollingTimer, bodyMetrics, physicsMetrics, ruckMetrics,
  type TarcsSnapshot,
} from './tarcsMetrics';
import { drawCRT, project, type Camera } from '../render/retro';
import { ENV_3D, ThreeCanvas, drawCenterReticle, renderHealth, noteRenderFault } from '../render/ThreeCanvas';
import { assessRender, drawHealthOverlay } from '../render/renderHealth';
import { ThreePlayerManager } from '../render/ThreePlayerManager';
import { conditionsFor, qualityFor, type Conditions } from '../render/conditions';
import { FxDirector } from '../render/fxDirector';
import { Btn, Panel, Kbd } from './kit';
import { DIFFICULTY_TABLE } from '../game/data';
import { contractFor } from '../game/jlr';
import { SpaceRemap } from './SpaceRemap';
import { TutorialOverlay, CameraPanel } from './TutorialOverlay';
import { stepAt } from '../game/tutorial';
import { pollGamepad, emptyPrev, PrevGp } from '../game/gamepad';
import { ScoreBug, MatchIntro, PlayerSpotlight, GamepadBadge, ConditionsStrip, FormStrip, TmoCard, CardCard, ReplayFrame } from './broadcast';
import { LoadingScreen } from './LoadingScreen';

/** Hand control back to the browser so it can paint and answer input. */
const yieldToBrowser = () => new Promise<void>((r) => {
  let settled = false;
  const finish = () => {
    if (!settled) {
      settled = true;
      r();
    }
  };
  const rafId = requestAnimationFrame(() => {
    setTimeout(finish, 0);
  });
  setTimeout(() => {
    cancelAnimationFrame(rafId);
    finish();
  }, 100);
});

/**
 * How long the boot is allowed to take before it is declared over anyway, and how
 * long the squad rig in particular gets, in milliseconds.
 *
 * These are not timeouts on the *work* — nothing is cancelled, and a rig that lands
 * afterwards still replaces the procedural bodies. They are timeouts on the
 * *waiting*: the promise that the loading overlay is held behind. Two numbers, nine
 * seconds apart, so that the usual slow case (a 6.3 MB GLB over a proxy) gives up on
 * the rig first and gets a real kick-off with plain men, and the watchdog only fires
 * if something earlier has gone wrong as well.
 *
 * What the 6 s is measured against, so nobody tunes it blind: `curl` through the dev
 * server serves the whole 6.3 MB rig in 11 ms warm, and 15.9 s once — while the
 * server was mid-restart, which is a broken pipeline, not a slow asset. The number
 * that matters is the browser's own fetch of it across the preview proxy, and that is
 * why `index.html` preloads the GLB at document time instead of waiting for the mount.
 */
const RIG_BUDGET_MS = 6000;
const BOOT_BUDGET_MS = 15000;

/**
 * On-screen render-health diagnostics (draw calls, triangles, framebuffer,
 * pixel probe and the resolved conditions). Off by default so the match screen
 * stays clean; append `?debug` to the URL to bring them back when a regression
 * is suspected. The small orange fault text in the bottom-left is separate and
 * only ever appears when something has actually gone wrong.
 */
const DEBUG_RENDER = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('debug');

/** Every verb, one key. Remappable by editing this table. */
export const KEYMAP: Record<string, string> = {
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
  w: 'up', arrowup: 'up',
  s: 'down', arrowdown: 'down',
  ' ': 'action',
  shift: 'sprint',
  j: 'passL', k: 'passR',
  u: 'cutL', o: 'cutR',
  l: 'kick', h: 'grubber', p: 'drop',
  i: 'contact', f: 'fend', g: 'step',
  x: 'tackleDive', c: 'tackleSmother',
  e: 'dummy', q: 'switchPlayer',
  /* Shirts 1–12 use the compact number row. Shift+1/2/3 (the !/@/#
   * key values browsers emit) cover shirts 13–15 without stealing a verb. */
  t: 'distribute',
  r: 'replay', tab: 'stats', escape: 'pause',
  /* SPEC_06 — B toggles the facing/strafe debug overlay (view/gait/lat). */
  b: 'animDebug',
  /* V toggles the player-driven first/third person rig (src/render/camera.ts). */
  v: 'viewMode',
  /* F3 toggles the TARCS physics/ruck/body telemetry overlay. */
  f3: 'tarcs',
  /* SPEC_25 — the two mouse buttons are keys by another name here: the same edge
   * sets, the same hold semantics, the same remap table. Synthetic tokens so a
   * `keys.current` entry means exactly one thing: something is being held.
   * `n`/`m` are the keyboard's version of the same two holds, and they exist because
   * a right mouse button is not universal hardware — `m` is held and RELEASED so the
   * grip and the drop both have a keyboard shape. `v` was the obvious third letter and
   * the view rig got it first, which is the right winner: a camera mode outranks an
   * alias for a mouse button. */
  mouse0: 'secure', mouse2: 'handsUp',
  n: 'handsUp', m: 'secure',
};

/** Number-row role lock. The three shifted symbols are the only extra physical
 * keys needed to address shirts 13–15 while keeping 1–9, 0, - and = readable
 * and available exactly as the on-pitch legend promises. */
export function roleNumberFromPressed(raw: Set<string>): number | null {
  const direct: Record<string, number> = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '0': 10, '-': 11, '=': 12,
  };
  for (const [key, num] of Object.entries(direct)) if (raw.has(key)) return num;
  const shifted: Record<string, number> = {
    '!': 13, '@': 14, '#': 15,
    /* US and ISO layouts expose these as convenient unshifted aliases. */
    '[': 13, ']': 14, '\\': 15, '_': 13, '+': 14,
  };
  for (const [key, num] of Object.entries(shifted)) if (raw.has(key)) return num;
  return null;
}

export function MatchView({ cfg, onExit, onFinish, clinic, objective, tutorial }: {
  cfg: MatchConfig; onExit: () => void;
  onFinish: (r: { a: number; b: number; events: unknown[] }) => void;
  clinic?: boolean;
  objective?: { name: string; target: string; margin: number } | null;
  tutorial?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dirRef = useRef<Director | null>(null);
  /** The transparent WebGL overlay (GLB squad) and its asset manager. */
  const threeRef = useRef<ThreeCanvas | null>(null);
  const playersRef = useRef<ThreePlayerManager | null>(null);
  const threeDivRef = useRef<HTMLDivElement | null>(null);
  const keys = useRef<Set<string>>(new Set());
  const prev = useRef<Set<string>>(new Set());
  /** Recent world-space ball points while it is airborne, for the flight trail. */
  const ballTrailRef = useRef<{ x: number; y: number; z: number }[]>([]);
  const [, force] = useState(0);
  const [showStats, setShowStats] = useState(false);

  /* ---- player-driven first/third person rig (V) --------------------------
   * Off by default: the broadcast director owns the camera unless the player
   * explicitly takes it. `rigRef` holds the pure state from render/camera.ts;
   * `plockRef` owns the browser pointer lock. */
  const rigRef = useRef(createRigState('THIRD'));
  const plockRef = useRef<PointerLock | null>(null);
  const [rigOn, setRigOn] = useState(false);
  const [rigLocked, setRigLocked] = useState(false);
  const rigOnRef = useRef(false);
  /* Default-camera hand-off. The fantasy is that you are one locked shirt in a
   * live team, so once a match with a human shirt boots (i.e. not the skills
   * clinic, where a top-down broadcast is what the drill needs) the player rig
   * is ARMED automatically in third person, seeded from wherever the director's
   * camera already is. This is exactly the first-V arming path — minus the
   * pointer-lock grab, which must stay a click so the intro card and menus stay
   * reachable. `autoCamRef` guards it so only the first real kick-off flips it. */
  const autoCamRef = useRef(false);
  const rigCamRef = useRef<Camera>({
    x: 0, z: 0, h: 1.68, yaw: 0, tilt: 0, fov: 1.2, shake: 0, horizon: 0.5, roll: 0,
  });
  const [tick, setTick] = useState(0);
  const [slow, setSlow] = useState(1);
  /* SPEC_06 — always-available facing/strafe debug overlay, off by default. */
  const [showAnimDebug, setShowAnimDebug] = useState(false);

  /* ---- TARCS debug telemetry (F3) ---------------------------------------
   * The samplers are refs, not state: they are written every frame, and
   * putting them in state would re-render React 60 times a second just to
   * display a frame-time counter — the measurement would distort the thing
   * being measured. `tarcs` state is refreshed on a slow interval instead. */
  const [showTarcs, setShowTarcs] = useState(false);
  const showTarcsRef = useRef(false);
  const simTimer = useRef(new RollingTimer(90));
  const frameTimer = useRef(new RollingTimer(90));
  const [tarcs, setTarcs] = useState<TarcsSnapshot | null>(null);
  const tarcsLive = useRef<TarcsSnapshot | null>(null);

  /* Publish the telemetry to React at 10 Hz. The panel is sampled every frame
   * but only RENDERED ten times a second: fast enough to read a spike, slow
   * enough that the debug tool is not itself a measurable cost, and slow
   * enough that the digits are legible rather than a blur. */
  useEffect(() => {
    if (!showTarcs) { setTarcs(null); return; }
    const id = window.setInterval(() => {
      if (tarcsLive.current) setTarcs({ ...tarcsLive.current });
    }, 100);
    return () => window.clearInterval(id);
  }, [showTarcs]);
  /* AAA broadcast — match-day intro card and gamepad connection badge. */
  const [intro, setIntro] = useState(true);
  /* null once the world is built; drives the loading overlay until then. */
  const [load, setLoad] = useState<{ stage: string; progress: number } | null>(
    { stage: 'Preparing the ground', progress: 0 });
  /* Mirror of `load` for the rAF loop, which closes over stale state. */
  const loadingRef = useRef(true);
  /** The stage the boot last announced, so the watchdog can say what it was waiting
   *  for instead of clearing the overlay and leaving the player to guess. */
  const bootStage = useRef('Preparing the ground');
  const bootWatchdog = useRef(0);
  /** non-null when the boot was abandoned at a stage that never finished. */
  const [bootStall, setBootStall] = useState<string | null>(null);
  const introRef = useRef(true);
  const gpPrev = useRef<PrevGp>(emptyPrev());
  const [gp, setGp] = useState<{ connected: boolean; name: string }>({ connected: false, name: '' });
  /* AAA — spoken commentary reads only new feed lines, never repeats them. */
  const spokenRef = useRef('');
  /* SPEC_24 — the last conditions object handed to the renderer. `conditionsFor`
   * caches, so identity is the change test: comparing the object is free and
   * cannot drift out of step with a hand-written key. */
  const condRef = useRef<Conditions | null>(null);
  const fxRef = useRef<FxDirector | null>(null);
  /* SPEC_24 — hit-stop, in seconds of real time still to be slowed down. */
  const hitStopRef = useRef(0);
  /* Camera shake contributed by the FX director, decayed here in real time. */
  const fxShakeRef = useRef(0);

  useEffect(() => {
    /* The match-day card is an overlay, not a pause. It sits over the live
     * kick-off and fades on its own or on any press — it must never hold the
     * world frozen while a player waits. */
    const t = window.setTimeout(() => { setIntro(false); introRef.current = false; }, 3600);
    return () => window.clearTimeout(t);
  }, []);

  if (!dirRef.current) {
    dirRef.current = new Director(cfg);
    if (tutorial) dirRef.current.startTutorial();
    if (typeof window !== 'undefined') {
      (window as any).match = dirRef.current;
      (window as any).director = dirRef.current;
      (window as any).M_ID = dirRef.current.M_ID;
      (window as any).data = { M_ID: dirRef.current.M_ID, cfg: dirRef.current.cfg };
    }
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (KEYMAP[k]) e.preventDefault();
      keys.current.add(k);
      /* T-10 — browser policy: audio may only start inside a user gesture. */
      dirRef.current?.audio.userGesture();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    /* Pointer lock lives on the HUD canvas: it is the topmost full-bleed
     * element, so it receives the click wherever the player aims. */
    if (canvasRef.current && !plockRef.current) {
      plockRef.current = new PointerLock(canvasRef.current, {
        onChange: (locked) => setRigLocked(locked),
      });
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    /* Browser autoplay policy: the keydown above only covers players who reach
     * the pitch via the keyboard. `armFirstGesture` catches every other route
     * (touch, a click on the HUD, a pointer event from the menu) and removes
     * itself once the context is actually running. */
    dirRef.current?.audio.armFirstGesture(window);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      dirRef.current?.audio.disarmFirstGesture();
      plockRef.current?.dispose();
      plockRef.current = null;
    };
  }, []);

  useEffect(() => {
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      dirRef.current?.setZoom(dirRef.current.zoom + Math.sign(e.deltaY) * 0.08);
    };
    /* SPEC_25 — the mouse. Right button brings the hands up, left button takes the
     * ball and releasing it drops it. `contextmenu` is suppressed on the canvas only,
     * because the browser's own menu over the pitch would both eat the hold and make
     * the game look broken; every other element keeps its menu. Mouseup is listened to
     * on the window as well as the canvas, since a button released outside the frame
     * still has to let the hands down — a stuck right button is a player permanently
     * reaching, which is the kind of bug that reads as "the game froze". */
    const down = (e: MouseEvent) => {
      const b = e.button === 2 ? 'mouse2' : e.button === 0 ? 'mouse0' : null;
      if (!b) return;
      e.preventDefault();
      keys.current.add(b);
      dirRef.current?.audio.userGesture();
    };
    const up = (e: MouseEvent) => {
      keys.current.delete(e.button === 2 ? 'mouse2' : e.button === 0 ? 'mouse0' : '');
    };
    const menu = (e: Event) => e.preventDefault();
    const c = canvasRef.current;
    c?.addEventListener('wheel', wheel, { passive: false });
    c?.addEventListener('mousedown', down);
    c?.addEventListener('contextmenu', menu);
    window.addEventListener('mouseup', up);
    return () => {
      c?.removeEventListener('wheel', wheel);
      c?.removeEventListener('mousedown', down);
      c?.removeEventListener('contextmenu', menu);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  /* The 3D layer: WebGL canvas + pooled GLB player manager. Created once.
   * Under ENV_3D this is the world (pitch, fog, uprights, actors); the 2D
   * canvas is a transparent HUD overlay stacked above it. */
  /* ---------------------------------------------------------------- boot --
   * Building the world is expensive: procedural turf maps, the stadium mesh
   * set, the post-processing targets and a 6.3 MB rigged GLB. Doing all of it
   * in one synchronous block starves the event loop for seconds — the browser
   * cannot paint or answer input, and the tab looks frozen.
   *
   * So each stage awaits `yieldToBrowser()` before the next. The total work is
   * unchanged, but it is now split across frames, so the loading screen
   * animates and the window stays responsive throughout. */
  useEffect(() => {
    const host = threeDivRef.current;
    if (!host) return;
    let cancelled = false;
    let three: ThreeCanvas | null = null;

    (async () => {
      loadingRef.current = true; bootStage.current = 'Preparing the ground';
      setLoad({ stage: 'Preparing the ground', progress: 0.04 });
      /* THE LAST RESORT FOR A STALLED BOOT. Every stage of this sequence is now
       * written so it cannot sit pending forever — the rig load is raced against a
       * budget, the shader handover is caught, the WebGL layer is caught — but the
       * rule the screenshot taught is that a loading screen is only ever as honest as
       * the slowest thing it waits for, and a user staring at "BRINGING OUT THE
       * TEAMS 66%" cannot tell a slow network from a broken game. So a single watchdog
       * lifts the curtain anyway, naming the stage that did not finish, and whatever
       * was still arriving is allowed to arrive late (the stand-in squad retires
       * itself whenever the rig lands). A game you can play with plain men beats a
       * progress bar you can admire. */
      const stall = window.setTimeout(() => {
        if (!loadingRef.current || cancelled) return;
        loadingRef.current = false;
        setBootStall(bootStage.current);
        setLoad(null);
      }, BOOT_BUDGET_MS);
      bootWatchdog.current = stall;
      await yieldToBrowser();
      if (cancelled) return;

      // Stadium + procedural turf (~0.6 s).
      /* Constructing the WebGL layer is the one boot step that can fail for
       * reasons that have nothing to do with this code: no GL on the machine, a
       * blocked context in a sandboxed frame, a driver that refuses the canvas.
       * Letting that throw left the whole async boot dead in the water — the
       * loading overlay never cleared and the 2D layer, which can draw this
       * match on its own, was never told to. So: catch it, say so on screen, and
       * carry on with the fallback view. */
      try {
        three = new ThreeCanvas(host);
      } catch (e) {
        three = null;
        renderHealth.world = 'dead';
        noteRenderFault('WebGL layer', e);
      }
      threeRef.current = three;
      if (cancelled) return;

      loadingRef.current = true; setLoad({ stage: 'Raising the stands', progress: 0.34 });
      bootStage.current = 'Raising the stands';
      await yieldToBrowser();
      if (cancelled) return;

      /* The look goes on before the squads are named, so the first frame anyone
       * sees is already the match's own weather. Read from the director rather
       * than props because the options screen writes straight onto the live
       * match config. */
      const d0 = dirRef.current;
      if (d0 && three) {
        /* Wrapped, because this is one of the two stages that used to be able to end
         * the boot without ending it: `applyConditions` reaches into shader uniforms
         * of a material the environment builds lazily, and if that handover is not
         * ready the throw escaped through an async body nothing was holding — so no
         * error surfaced, no overlay cleared, and the screen sat on its progress bar
         * at 34% forever. The weather is not worth a match: the 3D layer keeps its
         * default look, and the engine still gets its audio and surface, which are
         * the parts the simulation actually needs. */
        try {
          const cond0 = three.syncConditions(d0.options);
          condRef.current = cond0;
          three.particles?.setFog(cond0.fogColor, cond0.fogDensity * 14);
          d0.audio.setWeather(cond0.precip === 'RAIN' ? cond0.precipDensity : 0, cond0.windSpeed);
          d0.audio.setSurface(d0.pitch.firm);
        } catch (e) {
          noteRenderFault('weather on the 3D layer', e);
        }
      }
      /* TARCS — hand the physics world the audio engine, so Rapier's own
       * collision events drive the impact synthesiser directly. Safe before the
       * Rapier bootstrap has resolved; ThreeCanvas defers the subscription. */
      if (d0 && three) three.attachMatchAudio(d0.audio);
      /* The FX director is the only presentation object in this tree allowed to
       * hold both the particle pool and the stadium: it reads the simulation and
       * writes light and matter into the frame, never back into the engine. */
      if (three) fxRef.current = new FxDirector(three.particles, three.environment);

      loadingRef.current = true; setLoad({ stage: 'Naming the squads', progress: 0.56 });
      bootStage.current = 'Naming the squads';
      await yieldToBrowser();
      if (cancelled) return;

      if (three) {
        const players = new ThreePlayerManager(three);
        playersRef.current = players;

        loadingRef.current = true; setLoad({ stage: 'Bringing out the teams', progress: 0.66 });
      bootStage.current = 'Bringing out the teams';
        await yieldToBrowser();
        if (cancelled) return;

        /* THE RIG HAS A BUDGET, NOT A HANDSHAKE. 6.3 MB of skinned animation is a
         * lot to pull through a dev proxy, and before this line the boot simply
         * awaited the load — so a promise that never settled (which is what a throw
         * inside a callback-shaped loader produced) left the game sitting at 66%
         * with no error anywhere and no match behind it. A kick-off with procedural
         * bodies is a worse-looking match; a kick-off that never happens is not a
         * match at all.
         *
         * The race does not cancel anything. `players.load()` keeps running, and if
         * it lands late `clearStandIn` retires the boxes in its own time — which is
         * why the discard-catch below matters: after the timeout nobody is awaiting
         * this promise, and a late failure must not become an unhandled rejection. */
        let rigTimer = 0;
        const boot = players.load().catch(() => { /* the manager has already said why, in renderHealth */ });
        try {
          await Promise.race([
            boot,
            new Promise<'slow'>((res) => { rigTimer = window.setTimeout(() => res('slow'), RIG_BUDGET_MS); }),
          ]);
        } catch {
          /* Nothing to do here but let it go: the manager has already recorded
           * the reason in `renderHealth`, put procedural bodies on the field, and
           * left the console line. A squad whose model is missing is a match with
           * plain men in it, not a match that stops. */
        } finally {
          window.clearTimeout(rigTimer);
        }
        if (cancelled) return;
      }

      setLoad({ stage: 'Kick-off', progress: 1 });
      bootStage.current = 'Kick-off';
      await yieldToBrowser();
      if (cancelled) return;
      window.clearTimeout(bootWatchdog.current);
      loadingRef.current = false; setLoad(null);
    })();

    return () => {
      cancelled = true;
      /* A boot abandoned by React (StrictMode's double mount, a fast unmount, a
       * quality switch that rebuilds the canvas) must not leave a timer that fires
       * into a dead component and calls setState on it. */
      window.clearTimeout(bootWatchdog.current);
      fxRef.current = null;
      three?.dispose();
      threeRef.current = null;
      playersRef.current = null;
    };
  }, []);

  /* ---- default camera: hand the view to your man once the world is up ----
   * You are one locked shirt in a live team, so when a real match (not the
   * skills clinic) finishes booting and a human shirt is on the field, ARM the
   * player rig in THIRD person — seeded from wherever the director's camera
   * already is, exactly like a first V press but WITHOUT grabbing pointer lock
   * (a click still does that, so the intro card and menus stay reachable). */
  useEffect(() => {
    if (load !== null || autoCamRef.current) return;
    const d0 = dirRef.current;
    if (!d0 || clinic) return;
    const locked = d0.ctrlPlayer && d0.isHuman(d0.ctrlPlayer.team);
    if (!locked) return;
    const st = rigRef.current;
    if (st.mode !== 'THIRD') { st.mode = 'THIRD'; st.blend = 0; }
    st.yaw = st.smoothYaw = d0.cam.yaw;
    st.pitch = st.smoothPitch = -d0.cam.tilt;
    st.posX = d0.cam.x; st.posZ = d0.cam.z; st.posH = d0.cam.h;
    rigOnRef.current = true;
    setRigOn(true);
    autoCamRef.current = true;
  }, [load, clinic]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const d = dirRef.current;
      if (!d) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const inp: Input = { ...NO_INPUT };
      for (const raw of keys.current) {
        const m = KEYMAP[raw];
        if (!m) continue;
        switch (m) {
          case 'left': inp.left = true; break;
          case 'right': inp.right = true; break;
          case 'up': inp.up = true; break;
          case 'down': inp.down = true; break;
          case 'action': inp.sprint = true; break;
          case 'sprint': inp.sprint = true; break;
          case 'passL': inp.passL = true; break;
          case 'passR': inp.passR = true; break;
          case 'cutL': inp.cutL = true; break;
          case 'cutR': inp.cutR = true; break;
          case 'kick': inp.kick = true; break;
          case 'grubber': inp.grubber = true; break;
          case 'drop': inp.drop = true; break;
          case 'contact': inp.contact = true; break;
          case 'fend': inp.fend = true; break;
          case 'step': inp.step = true; break;
          case 'dummy': inp.dummy = true; break;
          case 'tackleDive': inp.tackleDive = true; break;
          case 'tackleSmother': inp.tackleSmother = true; break;
          case 'switchPlayer': inp.switchPlayer = true; break;
          case 'distribute': inp.distribute = true; break;
          case 'handsUp': inp.handsUp = true; break;
          case 'secure': inp.secure = true; break;
        }
      }
      // space is sprint while held and action on the edge
      const pressed = new Set<string>();
      const rawPressed = new Set<string>();
      for (const raw of keys.current) {
        if (!prev.current.has(raw)) {
          pressed.add(KEYMAP[raw] ?? raw);
          rawPressed.add(raw);
        }
      }
      /* SPEC_25 — Space doubles as the punt trigger. The engine only honours it inside
       * the 300 ms drop window, so sprint and every other Space verb are untouched
       * outside it: one physical key, two meanings, and the state machine is the only
       * thing that decides which. */
      if (pressed.has('action')) pressed.add('punt');
      /* Playtest P1.4: hold-to-kick needs the RELEASE edge too. */
      const released = new Set<string>();
      for (const raw of prev.current) if (!keys.current.has(raw)) released.add(KEYMAP[raw] ?? raw);

      /* PLAYER CONTROLS — role shortcuts are intentionally not folded into
       * Input: they are a persistent assignment, never a movement verb. Q
       * remains a live emergency switch and is handled by the director. */
      const roleNum = roleNumberFromPressed(rawPressed);
      if (roleNum !== null) {
        d.selectRole(roleNum);
        force((n) => n + 1);
      }
      /* OPEN_PLAY resolves Q inside upOpen so one key edge cannot switch twice;
       * set pieces have no open-play branch, so the UI resolves their emergency
       * handoff here. */
      if (pressed.has('switchPlayer') && d.phase !== 'OPEN_PLAY'
        && d.phase !== 'REPLAY' && !d.phase.endsWith('_REPLAY')) {
        d.emergencySwitch();
        force((n) => n + 1);
      }

      /* AAA — the gamepad merges into the same verb stream as the keyboard:
       * held input first, then the rising/falling edges for the kick-meter,
       * waggles, pause and stats. */
      const gf = pollGamepad(gpPrev.current);
      gpPrev.current = gf;
      /* The matchday card consumes the input that dismisses it: if the player
       * skips with the pad's START that press must not also pause the match. */
      const gpSkip = gf.connected && gf.pressed.length > 0;
      const skip = introRef.current && (pressed.size > 0 || gpSkip);
      if (skip) {
        introRef.current = false; setIntro(false);
        pressed.clear(); released.clear();
        for (const k of Object.keys(NO_INPUT) as (keyof Input)[]) inp[k] = false;
        inp.run = inp.sprint;
        prev.current = new Set(keys.current);
      } else {
        if (gf.connected) {
          Object.assign(inp, gf.input);
          for (const k of gf.pressed) pressed.add(k);
          for (const k of gf.released) released.add(k);
          setGp((cur) => (cur.connected && cur.name === gf.name ? cur : { connected: true, name: gf.name }));
        } else {
          setGp((cur) => (cur.connected ? { connected: false, name: '' } : cur));
        }
        inp.run = inp.sprint;
        prev.current = new Set(keys.current);
      }

      // The tutorial card resumes on the keys it lists, and only those.
      if (d.tut.active && d.tut.showing) {
        const step = stepAt(d.tut.index);
        if (step && step.resumeOn.some((k) => pressed.has(k))) {
          d.resumeTutorial();
          force((n) => n + 1);
        }
      }
      if (pressed.has('pause')) { d.paused = !d.paused; force((n) => n + 1); }
      if (pressed.has('stats')) setShowStats((v) => !v);
      if (pressed.has('replay')) { if (!d.phase.includes('REPLAY')) d.enterReplay('REPLAY'); }
      /* SPEC_06 — B toggles the facing/strafe debug overlay. */
      if (pressed.has('animDebug')) setShowAnimDebug((v) => !v);
      if (pressed.has('tarcs')) {
        const on = !showTarcsRef.current;
        showTarcsRef.current = on;
        setShowTarcs(on);
        /* Start each session clean so the first reading is this run's, not a
         * stale mean from the last time the panel was open. */
        if (on) { simTimer.current.reset(); frameTimer.current.reset(); }
      }

      /* ---- V: take or hand back the camera ------------------------------
       * First V arms the rig and requests pointer lock. Subsequent presses
       * flip first <-> third. ESC (browser-owned) drops the lock but leaves
       * the rig armed, so the player keeps their view mode. */
      if (pressed.has('viewMode')) {
        if (!rigOnRef.current) {
          rigOnRef.current = true;
          setRigOn(true);
          /* Seed from the director's current shot so taking control does not
           * cut: the rig starts exactly where the broadcast camera was. */
          const st = rigRef.current;
          st.yaw = st.smoothYaw = d.cam.yaw;
          st.pitch = st.smoothPitch = -d.cam.tilt;
          st.posX = d.cam.x; st.posZ = d.cam.z; st.posH = d.cam.h;
          plockRef.current?.request();
        } else {
          toggleViewMode(rigRef.current);
          force((n) => n + 1);
          /* Auto-armed matches start WITHOUT pointer lock (the click takes it),
           * so the first V after that must grab the lock too — otherwise a
           * first-person switch has no way to look around. request() is a no-op
           * if the lock is already held. */
          plockRef.current?.request();
        }
      }

      /* Big hits squeeze three frames out of the second. `slow` is the player's
       * own game-speed setting, so the dip multiplies it rather than fighting
       * it, and it is driven by REAL time: slowing the simulation and then
       * letting the slowdown feed itself is how a hit-stop becomes a flatline. */
      const hitStop = hitStopRef.current > 0 ? 0.16 : 1;
      hitStopRef.current = Math.max(0, hitStopRef.current - dt);
      d.gameSpeed = slow * hitStop;
      /* One-man rugby never stops for you. The world simulates continuously
       * from the moment it is loaded — the match-day card is a translucent
       * overlay on top of a live kick-off, not a curtain that freezes play
       * until the player bothers to click it away. Nothing here makes the
       * field stand still and wait on a human. */
      if (!loadingRef.current) {
        if (showTarcsRef.current) {
          const t0 = performance.now();
          d.update(dt, inp, pressed, released);
          simTimer.current.push(performance.now() - t0);
        } else {
          d.update(dt, inp, pressed, released);
        }
      }
      if (showTarcsRef.current) frameTimer.current.push(dt * 1000);

      /* While the loading screen is up the world is still being assembled, so
       * there is nothing worth drawing and the boot stages need the main
       * thread more than the renderer does. Skipping the draw here is what
       * keeps the progress bar smooth instead of stuttering. */
      if (loadingRef.current) return;

      /* ---- player-driven camera rig ---------------------------------------
       * Runs AFTER the sim so it reads this frame's ball, and BEFORE the draw
       * so both the 2D and 3D layers consume the same Camera. Overwriting
       * d.cam (rather than threading a second camera through the renderers)
       * is what guarantees the two layers stay pixel-aligned — they already
       * agree to within 2 px, and that property is worth preserving. */
      if (rigOnRef.current) {
        const st = rigRef.current;
        const md = plockRef.current?.consume() ?? { dx: 0, dy: 0 };
        const bp = d.ballPoint();
        /* "YOU ARE THE PLAYER". The rig follows the shirt you control — the
         * role lock from PICK YOUR SHIRT (or Q / a number key) — not the ball
         * or the current carrier. Your WASD still steers that player through
         * the normal sim path (camera-relative), and mouse-look turns him;
         * the rig itself is given NO free-cam locomotion and NO ball-bias, so
         * first/third person sit on your man and only your man, consistently.
         * This is the fix for the view "following the ball at times" — it
         * cannot, because the anchor is you. */
        const me = d.ctrlPlayer;
        const mine = !!me && d.isHuman(me.team);
        const rigInput: RigInput = {
          fwd: false, back: false, left: false, right: false,
          sprint: false,
          mouseDX: md.dx, mouseDY: md.dy,
        };
        const res = updateRig(
          st,
          {
            self: mine
              ? { x: me.x, z: me.z, face: me.face ?? 0 }
              : { x: bp.x, z: bp.z, face: 0 },
            ball: null,            // never auto-look at the ball in player view
            ballLanding: null,
          },
          rigInput, dt, DEFAULT_TUNING, rigCamRef.current,
        );
        /* Keep the director's own shake so impacts still register. */
        res.camera.shake = d.cam.shake;
        Object.assign(d.cam, res.camera);
      }

      /* ---- TARCS telemetry ------------------------------------------------
       * Composed every frame into a ref (cheap, no re-render); the interval
       * below publishes it to React at a readable rate. */
      if (showTarcsRef.current) {
        const carrierNum = d.op ? d.op.carrierNum : null;
        const carrierTeam = d.op ? d.op.attacking : null;
        tarcsLive.current = {
          physics: physicsMetrics(simTimer.current, frameTimer.current),
          ruck: ruckMetrics(d.bd ?? null),
          bodies: bodyMetrics(
            d.live.map((q) => ({
              team: q.team, num: q.num, vx: q.vx, vz: q.vz,
              stamina: q.stamina,
              /* A body is "ACTIVE" when the ragdoll solver owns it. The
               * renderer is the only thing that knows, so ask it; when the
               * 3D layer is absent (headless/2D) nobody is ragdolled. */
              ragdoll: playersRef.current?.isRagdolled(q.team, q.num) ?? false,
            })),
            carrierNum, carrierTeam,
          ),
        };
      }

      /* ---- draw ---- */
      const cv = canvasRef.current;
      if (cv) {
        const ctx = cv.getContext('2d')!;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (cv.width !== w * devicePixelRatio || cv.height !== h * devicePixelRatio) {
          cv.width = w * devicePixelRatio; cv.height = h * devicePixelRatio;
        }
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        const view = { w, h };

        /* Camera shake: one offset per frame, shared by the 2D pitch and the
         * 3D overlay so players and pitch lines shake as one. */
        const jx = d.cam.shake ? (Math.random() - 0.5) * d.cam.shake * 14 : 0;
        const jy = d.cam.shake ? (Math.random() - 0.5) * d.cam.shake * 11 : 0;

        drawMatch(ctx, d, view, playersRef.current ?? undefined, { x: jx, y: jy });
        /* Feet markers (rings, range, kick aim) are painted on the 2D layer
         * BEFORE the 3D squad so the GLB players stand on top of them. */
        drawIndicators(ctx, d, view);
        /* A pass/kick in the air is drawn as a REAL rugby ball with a fading
         * motion trail, painted on the 2D layer so it reads even in player
         * (FPV/3rd) view, where a fast ball can otherwise cross the frame and
         * get lost behind hands and shoulders. */
        drawBallFlight(ctx, d, view, ballTrailRef.current);
        drawCenterReticle(ctx, w, h, centerReticleState(
          d, keys.current, rigOnRef.current && rigRef.current.mode === 'FIRST',
        ));

        /* ---- 3D world (pitch + uprights under ENV_3D, plus the GLB squad) ---- */
        const three = threeRef.current;
        if (three) {
          three.resize();
          /* One camera offset for the whole frame: the 2D pitch and the 3D squad
           * are shaken by the same numbers, which is the only reason they do not
           * slide apart when a ruck collapses. */
          const shake = (d.cam.shake || 0) + fxShakeRef.current;
          fxShakeRef.current = Math.max(0, fxShakeRef.current - dt * 2.4);
          three.syncCamera({ ...d.cam, shake }, view, jx, jy);
          const local = d.ctrlPlayer;
          playersRef.current?.setLocalViewMode(
            local?.team ?? null, local?.num ?? null,
            rigOnRef.current && rigRef.current.mode === 'FIRST',
          );
          playersRef.current?.update(d, view, d.cam, dt);
          /* ONE conditions object per frame, resolved from the options the engine
           * already owns, pushed into the sky, the turf, the crowd and the kit.
           * `syncConditions` is what makes the option screen live mid-match;
           * the identity test makes polling it free. */
          const cond = three.syncConditions(d.options);
          if (cond !== condRef.current) {
            condRef.current = cond;
            three.particles?.setFog(cond.fogColor, cond.fogDensity * 14);
            d.audio.setWeather(cond.precip === 'RAIN' ? cond.precipDensity : 0, cond.windSpeed);
            d.audio.setSurface(d.pitch.firm);
          }
          playersRef.current?.setSoiling(cond.mud, cond.wetness);
          /* FLAT 16-BIT drops the live solve along with the bloom and the
           * shadows — but it does not go back to a canned hug: the tier replays a
           * fall that was solved offline instead (ragdollClips.ts). Any fall
           * already in progress is released here, because the switch can move
           * mid-match from the menu. */
          if (playersRef.current) playersRef.current.ragdollEnabled = cond.quality !== 'LEGACY';
          if (cond.quality === 'LEGACY') playersRef.current?.clearFalls();
          /* LEGACY is the budget tier: it drops physics fall-down along with
           * the bloom and the shadows, and the men keep their canned tackle. */
          if (playersRef.current) playersRef.current.ragdollEnabled = cond.quality !== 'LEGACY';
          playersRef.current?.setShadowStrength(cond.shadowStrength * (cond.shadows ? 0.55 : 1));
          const env = three.environment;
          if (env) {
            const recent = d.t - d.bannerAt < 2.2;
            const b = (d.banner || '').toUpperCase();
            if (recent && b.includes('TRY')) env.flashAdBoard('TRY');
            else if (recent && /(PENALTY|YELLOW|CARD|NO GOOD)/.test(b)) env.flashAdBoard('PENALTY');
            env.update(d.t, dt, three.camera);
          }
          /* IMPACT FX: turf, mud, dust, breath, blood, confetti, pitch scars,
           * crowd, press flashes — and the two numbers that come back out. */
          const fxPulse = fxRef.current?.update(d, cond, dt) ?? { impact: 0, shake: 0 };
          if (fxPulse.impact > 0) {
            hitStopRef.current = Math.max(hitStopRef.current, 0.05 + fxPulse.impact * 0.07);
            fxShakeRef.current = Math.min(12, fxShakeRef.current + fxPulse.impact * 9);
          }
          if (fxPulse.shake > 0) fxShakeRef.current = Math.min(12, fxShakeRef.current + fxPulse.shake);
          /* THE FLOOR. A solved body kicks up a second line of turf when it
           * arrives a second time — a roll, a skip, a knee on the deck. The
           * manager reports the contacts, this spends them, because the pitch
           * and the weather belong to the renderer and the fall does not. */
          const hits = playersRef.current?.drainGroundHits() ?? [];
          /* The solver reports every joint that reached the deck; the frame does
           * not need all of them. A knee and an elbow landing 0.1 s apart are one
           * cloud of turf, not six, and the wear canvas is already running to a
           * budget. Take the heaviest few. */
          if (hits.length) {
            hits.sort((a, b) => b.force - a.force);
            let spent = 0;
            for (const h of hits) {
              if (h.force < 0.22 || spent >= 3) continue;
              spent++;
              three.environment?.addScar(h.x, h.z, 0.55 + h.force * 0.5);
              three.particles?.emit(cond.mud > 0.5 ? 'MUD' : 'DUST', {
                count: 3 + Math.round(h.force * 6), x: h.x * 1.65,
                /* the turf is domed; clods that spawn at y=0 start inside it at
                 * the centre of the field and pop out a metre later */
                y: 0.06 + (three.environment?.riseAt(h.x) ?? 0), z: -h.z * 1.65,
                speed: 0.9 + h.force, up: 0.5, scale: 0.8, opacity: 0.55,
              });
            }
          }
          /* The weather itself: precipitation, wet ground, mist, lamp haze. */
          three.updateMatchDay(d.cam, view, dt);
          three.render(dt);
        }
        /* SPEC_06 — facing/strafe live per-actor readouts (toggle with B). */
        if (showAnimDebug) drawFacingStrafeOverlay(ctx, d.phase, view);
        if ((d.options.radar ?? 1) === 1) drawMinimap(ctx, d, view);
        const crt = d.options.crt ?? 1;
        if (crt > 0) drawCRT(ctx, view, crt === 2 ? 1.6 : 1);
        if (d.phase.includes('REPLAY')) {
          ctx.fillStyle = 'rgba(232,207,70,0.92)'; ctx.fillRect(0, 12, 78, 18);
          ctx.fillStyle = '#14161d'; ctx.font = '900 11px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText('● REPLAY', 8, 25);
        }
        if (d.t - d.bannerAt < 2.2) {
          ctx.font = '900 28px ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.globalAlpha = Math.min(1, (2.2 - (d.t - d.bannerAt)) / 0.6);
          ctx.lineWidth = 6; ctx.strokeStyle = '#14161d';
          ctx.strokeText(d.banner, view.w / 2, view.h * 0.28);
          ctx.fillStyle = '#e8cf46'; ctx.fillText(d.banner, view.w / 2, view.h * 0.28);
          ctx.globalAlpha = 1; ctx.textAlign = 'left';
        }
        if (d.paused) drawWipe(ctx, view, 0.5);
        /* RENDER HEALTH — a self-diagnostic overlay driven by the real driver
         * counters (draw calls, triangles, framebuffer completeness). Gated
         * behind ?debug (see DEBUG_RENDER) so it never ships on the clean
         * screen. See render/renderHealth.ts. */
        if (DEBUG_RENDER) {
        const rh = threeRef.current;
        if (rh) {
          try {
            const report = assessRender({
              renderer: rh.renderer,
              scene: rh.scene,
              target: null,
              drawCalls: rh.renderer.info.render.calls,
              triangles: rh.renderer.info.render.triangles,
              bufferW: rh.renderer.domElement.width,
              bufferH: rh.renderer.domElement.height,
              cssW: rh.renderer.domElement.clientWidth || view.w,
              cssH: rh.renderer.domElement.clientHeight || view.h,
              contextLost: rh.contextLost,
            });
            drawHealthOverlay(ctx, report, view);
            /* PIXEL PROBE — read the actual rendered colour at four points so a
             * dark frame says WHERE it is dark. Screen coords are converted to
             * GL (bottom-up) coords; readPixels right after the draw, before the
             * browser composites, so no preserveDrawingBuffer is needed. */
            const gl = rh.renderer.getContext() as WebGL2RenderingContext | null;
            if (gl && rh.renderer.domElement.width > 0) {
              const W = rh.renderer.domElement.width;
              const H = rh.renderer.domElement.height;
              const dpr = Math.min(1.75, window.devicePixelRatio || 1);
              const px = new Uint8Array(4);
              const sample = (sx: number, sy: number): string => {
                const gx = Math.round(sx * dpr);
                const gy = Math.round((1 - sy) * H - 1);
                if (gx < 0 || gx >= W || gy < 0 || gy >= H) return '----';
                gl.readPixels(gx, gy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                const h = (n: number) => n.toString(16).padStart(2, '0');
                return `#${h(px[0])}${h(px[1])}${h(px[2])}`;
              };
              const rows = [
                `sky    (0.50,0.10) ${sample(0.5, 0.10)}`,
                `horizon(0.50,0.42) ${sample(0.5, 0.42)}`,
                `pitch  (0.50,0.80) ${sample(0.5, 0.80)}`,
                `pitch  (0.25,0.80) ${sample(0.25, 0.80)}`,
              ];
              const c = condRef.current;
              if (c) {
                rows.push(
                  `cond  ${c.weather} / ${c.timeOfDay}  key ${c.keyColor}@${c.keyIntensity} sunEl ${c.sunEl.toFixed(2)}`,
                  `sky   zen ${c.skyZenith} mid ${c.skyMid} hor ${c.skyHorizon}`,
                  `fog   ${c.fogColor} dens ${c.fogDensity}  haze ${c.groundHaze}`,
                );
              }
              /* Read the browser-side turf albedo canvas directly. If these are
               * green (g channel dominant) the texture is generated fine and the
               * brown is a lighting/upload problem; if they are white/brown the
               * canvas itself is broken in this browser. */
              const env = threeRef.current?.environment as unknown as
                { turfCanvas?: HTMLCanvasElement } | null;
              const tc = env?.turfCanvas;
              if (tc && tc.width > 0) {
                const cx = tc.getContext('2d');
                if (cx) {
                  const hx = (n: number) => n.toString(16).padStart(2, '0');
                  const read = (fx: number, fy: number) => {
                    const d = cx.getImageData(
                      Math.floor(tc.width * fx), Math.floor(tc.height * fy), 1, 1).data;
                    return `#${hx(d[0])}${hx(d[1])}${hx(d[2])}`;
                  };
                  rows.push(
                    `turf  ${tc.width}x${tc.height}  ` +
                    `${read(0.25, 0.30)} ${read(0.50, 0.50)} ${read(0.75, 0.70)}`,
                  );
                }
              }
              ctx.save();
              ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              const y0 = Math.round(view.h * 0.22) + 250;
              ctx.fillStyle = 'rgba(8,11,18,0.92)';
              ctx.fillRect(Math.round(view.w / 2) - 230, y0, 460, rows.length * 18 + 12);
              ctx.strokeStyle = '#6ee7a0';
              ctx.strokeRect(Math.round(view.w / 2) - 230, y0, 460, rows.length * 18 + 12);
              rows.forEach((r, i) => {
                ctx.fillStyle = '#c8d2e0';
                ctx.fillText(r, Math.round(view.w / 2) - 214, y0 + 12 + i * 18);
              });
              ctx.restore();
            }
          } catch { /* diagnostics must never take the frame down */ }
        }
        }
      }
    };
    /* THE LOOP HAS TO OUTLIVE ITS OWN FRAME. The reschedule used to sit at the
     * bottom of the body, so one exception anywhere in the draw chain — and that
     * chain reaches a 6 MB GLB, an effect composer, and a GL context that can be
     * lost mid-frame — skipped the reschedule and stopped the picture for the
     * rest of the session, while the panels kept moving because a `setInterval`
     * drives them. A dead canvas next to a live HUD is the single most confusing
     * failure this project has had, and it was self-inflicted by this ordering. */
    let frameFaults = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      try {
        frame(now);
        frameFaults = 0;
      } catch (e) {
        frameFaults++;
        console.error('[match] frame', e);
        noteRenderFault(`frame ${frameFaults}`, e);
        /* Three bad frames in a row is not a transient: step back from the 3D
         * world entirely and let the 2D stadium carry the match. */
        if (frameFaults >= 3) renderHealth.world = 'dead';
      }
    };
    raf = requestAnimationFrame(loop);
    const ui = setInterval(() => setTick((t) => t + 1), 110);
    return () => { cancelAnimationFrame(raf); clearInterval(ui); };
  }, [slow, showAnimDebug, intro]);

  const d = dirRef.current;
  if (!d) return null;
  const A = d.A, B = d.B;
  /* AAA — spoken commentary overlays the feed every live tick when enabled.
   * Uses the browser speech engine, so no audio assets are required. */
  useEffect(() => {
    if ((d.options.spokenCommentary ?? 0) < 1) return;
    const line = d.feed[0]?.text ?? '';
    if (!line || line === spokenRef.current) return;
    spokenRef.current = line;
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(line.replace(/\s+/g, ' '));
      u.rate = 1.02;
      u.pitch = 0.82;
      u.volume = 0.6;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* a browser without voices just stays silent */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const density = ['MINIMAL', 'STANDARD', 'FULL', 'TELEMETRY'][d.options.hud ?? 1];
  const ctrl = d.ctrlPlayer;
  const contract = ctrl ? contractFor(ctrl.num) : null;

  const commandBar = () => {
    if (d.hint) return d.hint;
    if (d.phase === 'KICK' && d.kk) {
      return d.kk.stage === 'AIM'
        ? `A / D AIM THE KICK · SPACE TO SET POWER — ${d.kk.profile.label}`
        : d.kk.power === 0 ? 'SPACE TO SET POWER — STOP IN THE GOLD BAND' : 'SPACE TO SET ACCURACY';
    }
    if (d.phase === 'SCRUM' && d.scrim) {
      if (d.scrim.stage === 'ASSEMBLE') return d.scrim.cadence || 'FORMING THE SCRUM';
      return `${d.scrim.cadence} — POUND A / D TO PUSH THE PACK`;
    }
    if (d.phase === 'LINEOUT' && d.lo) {
      return d.lo.stage === 'ASSEMBLE' ? 'FORMING THE LINEOUT'
        : d.lo.stage === 'CALL' ? `A / D CALL · SPACE TO THROW — ${d.lo.call.label}`
          : d.lo.stage === 'THROW' ? 'SPACE INSIDE THE GOLD BAND FOR A STRAIGHT THROW' : 'THE BALL IS IN THE AIR';
    }
    if (d.phase === 'BREAKDOWN' && d.bd) {
      return `${d.bd.stage} — A / D POUND TO CLEAR OUT · SPACE COMMITS ONE MORE (${d.bd.commitA} IN)`;
    }
    if (d.phase === 'MAUL' && d.ml) return d.maulPrompt();
    /* Playtest P1.12: the verb strip under the commentary is gone — the
     * top-left CONTROLS widget is the one source of truth, and a second
     * copy was just noise over the feed. */
    return '';
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-black">
      {/* Layer 0/1 — under ENV_3D the WebGL canvas is the world (pitch, fog,
       * uprights, players) and the 2D canvas is a transparent HUD overlay
       * (minimap, CRT, banners, telemetry) sitting above it. Without the flag
       * the 2D canvas paints the pitch and WebGL is a transparent actor layer. */}
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${ENV_3D ? 'z-[2]' : 'z-0'}`} />
      <div ref={threeDivRef} className={`pointer-events-none absolute inset-0 ${ENV_3D ? 'z-0' : 'z-[1]'}`} />
      {/* TARCS telemetry. z-50, click-through, so it can never interfere with
        * pointer lock or the interactive menu layers above it. */}
      {showTarcs && tarcs && <TARCSHud snapshot={tarcs} />}
      {/* Player-camera status. Tells you which rig owns the view and, when the
        * pointer is not locked, how to get it back — a pointer-locked mode
        * with no visible way to re-enter it after ESC is a trap. */}
      {rigOn && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[40] -translate-x-1/2
                        rounded border border-emerald-400/60 bg-slate-950/85 px-3 py-1.5
                        font-mono text-[11px] font-bold tracking-wide text-emerald-300">
          {rigRef.current.mode === 'FIRST' ? 'FIRST PERSON' : 'THIRD PERSON'}
          <span className="ml-2 font-normal text-slate-400">V to switch</span>
          {!rigLocked && (
            <span className="ml-2 font-normal text-amber-300">· click to look</span>
          )}
        </div>
      )}
      {/* Layer 2 — every HUD panel lives inside this wrapper so the 3D players
       * can never cover the score bar, commentary, or phase readouts. */}
      <div className="pointer-events-none absolute inset-0 z-10">

      {/* LIVE CONTROL PANEL — top left, most logical action highlighted */}
      {(d.options.showControls ?? 1) > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 w-[232px]">
          <div className="border-2 border-[#3d4b66] bg-[#0d1220]/95 px-2 py-1.5">
            <div className="mb-1 flex items-baseline justify-between border-b border-[#26314a] pb-0.5">
              <span className="text-[8px] font-black tracking-[0.24em] text-[#7f8ea6]">CONTROLS</span>
              <span className="text-[8px] tracking-[0.16em] text-[#6f7f96]">{d.phase.replace('_', ' ')}</span>
            </div>
            <div className="space-y-0.5">
              {d.actionBar
                .filter((a) => (d.options.showControls ?? 1) === 2
                  || a.primary
                  || ['A / D', 'SPACE', 'J', 'K', 'T', 'X', 'C', 'Q'].includes(a.key))
                .slice(0, (d.options.showControls ?? 1) === 2 ? 99 : 7)
                .map((a, i) => (
                  <div key={i} className={`flex items-baseline gap-1.5 ${a.primary ? 'bg-[#6ee7a0]/15 px-1' : ''}`}>
                    <span className={`min-w-[44px] text-right text-[9px] font-black ${a.primary ? 'text-[#6ee7a0]' : 'text-[#e8cf46]'}`}>{a.key}</span>
                    <span className={`truncate text-[9px] leading-tight ${a.primary ? 'font-black text-[#6ee7a0]' : 'text-[#a9b6c8]'}`}>
                      {a.label}{a.primary ? ' ◀' : ''}
                    </span>
                  </div>
                ))}
            </div>
            {/* CHARGE METERS — the held pass and kick charges, live. A tap never
                shows here (it throws on release); a hold fills the bar toward
                the flat bullet / the raking kick. */}
            {(d.op?.passHold ?? 0) > 0 && (
              <div className="mt-1 border-t border-[#26314a] pt-0.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[8px] font-black tracking-[0.2em] text-[#e8cf46]">PASS CHARGE</span>
                  <span className="text-[8px] text-[#a9b6c8]">{(d.op?.passHold ?? 0) >= 0.6 ? 'FLAT AND HARD' : `${Math.round((d.op?.passHold ?? 0) * 100)}%`}</span>
                </div>
                <div className="mt-0.5 h-1.5 bg-[#26314a]">
                  <div className="h-1.5 bg-[#e8cf46]" style={{ width: `${Math.round((d.op?.passHold ?? 0) * 100)}%` }} />
                </div>
              </div>
            )}
            {(d.op?.kickCharge ?? 0) > 0 && (
              <div className="mt-1 border-t border-[#26314a] pt-0.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[8px] font-black tracking-[0.2em] text-[#6ee7a0]">KICK CHARGE</span>
                  <span className="text-[8px] text-[#a9b6c8]">{d.op?.kickKind} {Math.round((d.op?.kickCharge ?? 0) * 100)}%</span>
                </div>
                <div className="mt-0.5 h-1.5 bg-[#26314a]">
                  <div className="h-1.5 bg-[#6ee7a0]" style={{ width: `${Math.round((d.op?.kickCharge ?? 0) * 100)}%` }} />
                </div>
              </div>
            )}
            <div className="mt-1 border-t border-[#26314a] pt-0.5 text-[7px] leading-tight text-[#5f6f86]">
              SPACE = {d.contextVerb.label} · changeable in OPTIONS
            </div>
          </div>
        </div>
      )}

      {/* SCORE BAR — AAA broadcast bug by default, heritage 1991 from OPTIONS */}
      {(d.options.broadcast ?? 1) >= 1 ? (
        <ScoreBug d={d} objective={objective} density={density} />
      ) : (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
          <div className="border-2 border-[#e8cf46] bg-[#0d1220]/95 px-3 py-1">
            <div className="flex items-center gap-3">
              <span className="text-[15px] font-black text-[#e2664f]">{A.nation.short}</span>
              <span className="text-[22px] font-black tabular-nums text-[#f4efe2]">{A.score}</span>
              <span className="text-[11px] text-[#6f7f96]">v</span>
              <span className="text-[22px] font-black tabular-nums text-[#f4efe2]">{B.score}</span>
              <span className="text-[15px] font-black text-[#7fa3e6]">{B.nation.short}</span>
              <span className="ml-2 border-l border-[#3d4b66] pl-2 text-[11px] tabular-nums text-[#e8cf46]">{d.clockText}</span>
              <span className="text-[9px] tracking-[0.2em] text-[#6f7f96]">{d.half === 1 ? '1ST HALF' : '2ND HALF'}</span>
              <span className="text-[9px] tracking-[0.2em] text-[#8fa0b8]">{DIFFICULTY_TABLE[d.difficulty]?.name}</span>
            </div>
            {objective && (
              <div className="mt-0.5 text-[9px] tracking-[0.16em] text-[#e8cf46]">
                {objective.name} — TARGET {objective.target}
              </div>
            )}
            {(d.live.some((p) => p.sinbin > 0)) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-[9px] font-black tabular-nums text-[#f4efe2]">
                  {strengthText(d.activeCount('A'), d.activeCount('B'))}
                </span>
                {(['A', 'B'] as const).map((t) =>
                  d.live
                    .filter((p) => p.team === t && p.sinbin > 0)
                    .map((p) => (
                      <span
                        key={`${t}-${p.num}`}
                        className="inline-flex items-center gap-1 border border-[#e8cf46] bg-[#2a2412] px-1 text-[9px] font-black text-[#e8cf46]"
                      >
                        <span className="inline-block h-2.5 w-1.5 rounded-[1px] bg-[#f3cf2a]" />
                        {d.teams[t].nation.short} {p.num}
                        <span className="tabular-nums text-[#f4efe2]">{sinBinClock(p.sinbin)}</span>
                      </span>
                    )),
                )}
              </div>
            )}
            {density !== 'MINIMAL' && (
              <div className="mt-0.5 flex items-center gap-2 text-[9px] tracking-[0.16em] text-[#8fa0b8]">
                <span className={d.possession === 'A' ? 'text-[#e2664f]' : 'text-[#7fa3e6]'}>
                  {d.possession === 'A' ? '◀ ' + A.nation.short : B.nation.short + ' ▶'}
                </span>
                <span>·</span><span>{d.phase.replace('_', ' ')}</span>
                {d.op && <><span>·</span><span>PHASE {d.op.phase}</span></>}
                {d.momentum !== 0 && <><span>·</span><span className={d.momentum > 0 ? 'text-[#e2664f]' : 'text-[#7fa3e6]'}>MOMENTUM {d.momentum > 0 ? A.nation.short : B.nation.short}</span></>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONTROLLED PLAYER NAMEPLATE — four channels so you always know who you are */}
      {ctrl && (
        <div className="pointer-events-none absolute left-3 top-[196px] w-[232px]">
          <div className="border-2 border-[#6ee7a0] bg-[#0d1220]/95 px-2 py-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-black text-[#6ee7a0]">
                {ctrl.num} {A.players[ctrl.num - 1]?.name.split(' ').slice(-1)[0] ?? ''}
              </span>
              <span className="text-[8px] tracking-[0.16em] text-[#8fa0b8]">{contract?.pos}</span>
            </div>
            <div className="mt-0.5 h-1 w-full bg-[#0a0e16]">
              <div className="h-full bg-[#6ee7a0]" style={{ width: `${ctrl.stamina}%` }} />
            </div>
            <div className="mt-0.5 text-[8px] leading-tight text-[#7f8ea6]">{ctrl.job || 'SUPPORT'}</div>
          </div>
        </div>
      )}

      {/* PHASE PANELS */}
      <div className={`pointer-events-none absolute left-3 ${ctrl ? 'top-[258px]' : 'top-[196px]'} w-[232px] space-y-1`}>
        {(d.phase === 'KICK' || d.phase === 'KICK_REPLAY') && d.kk && (
          <Panel title="KICK-O-METER">
            <div className="text-[10px] font-black text-[#f4efe2]">{d.kk.profile.label}</div>
            <div className="text-[9px] text-[#7f8ea6]">{d.kk.kickerName} · KICKING</div>
            <div className="relative mt-1 h-4 border border-[#3d4b66] bg-[#0a0e16]">
              <div className="absolute inset-y-0" style={{ left: '62%', width: '18%', background: 'rgba(110,231,160,0.34)' }} />
              <div className="absolute inset-y-0 w-[3px] bg-[#e8cf46]" style={{ left: `${d.kk.meter * 100}%` }} />
              <div className="absolute right-1 top-0 text-[9px] font-black text-[#7f8ea6]">{d.kk.power > 0 ? 'ACCURACY' : 'POWER'}</div>
            </div>
            {d.kk.profile.atGoal && (
              <div className="mt-1 flex justify-between text-[9px] text-[#cfd8e6]">
                <span>{d.kk.goalDistance.toFixed(0)} m</span>
                <span>{d.kk.goalAngle.toFixed(0)}°</span>
                <span className={d.kk.goalProb > 0.7 ? 'text-[#6ee7a0]' : d.kk.goalProb > 0.45 ? 'text-[#e8cf46]' : 'text-[#ff6a5a]'}>
                  {(d.kk.goalProb * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </Panel>
        )}
        {d.phase === 'LINEOUT' && d.lo && (
          <Panel title="LINEOUT">
            <div className="text-[11px] font-black text-[#f4efe2]">{d.lo.call.label}</div>
            <div className="text-[9px] text-[#7f8ea6]">{d.lo.call.jumpers} IN THE LINE · {d.lo.stage}</div>
            {d.lo.stage === 'THROW' && (
              <div className="relative mt-1 h-3 border border-[#3d4b66] bg-[#0a0e16]">
                <div className="absolute inset-y-0" style={{ left: '55%', width: '20%', background: 'rgba(110,231,160,0.3)' }} />
                <div className="h-full w-[3px] bg-[#e8cf46]" style={{ marginLeft: `${d.lo.meter * 100}%` }} />
              </div>
            )}
          </Panel>
        )}
        {d.phase === 'SCRUM' && d.scrim && (
          <Panel title="SCRUM">
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>REFEREE</span><span className="font-black text-[#e8cf46]">{d.scrim.cadence || d.scrim.stage}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>FEED</span><span className="text-[#f4efe2]">{d.teams[d.scrim.feed].nation.short}</span></div>
            <div className="mt-1 h-2 w-full border border-[#3d4b66] bg-[#0a0e16]">
              <div className="h-full bg-[#6ee7a0]" style={{ width: `${(1 - Math.min(1, d.scrim.collapseRisk)) * 100}%` }} />
            </div>
            <div className="text-[8px] text-[#7f8ea6]">STABILITY · DRIVE {(d.scrim.netDrive * 100).toFixed(0)} cm</div>
          </Panel>
        )}
        {d.phase === 'BREAKDOWN' && d.bd && (
          <Panel title="BREAKDOWN">
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>STAGE</span><span className="text-[#f4efe2]">{d.bd.stage}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]">
              <span>COMMITTED</span><span className="text-[#f4efe2]">{d.bd.commitA} v {d.bd.commitB}</span>
            </div>
            <div className="mt-1 h-2 w-full border border-[#3d4b66] bg-[#0a0e16]">
              <div className="h-full bg-[#e8cf46]" style={{ width: `${Math.min(100, (d.bd.waggle / 4.2) * 100)}%` }} />
            </div>
            <div className="text-[8px] text-[#7f8ea6]">CLEAR-OUT · EP {d.bd.expectedPoints.toFixed(2)}</div>
          </Panel>
        )}
        {d.phase === 'MAUL' && d.ml && (
          <Panel title="MAUL">
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>BALL AT RANK</span><span className="text-[#f4efe2]">{d.ml.ballRank + 1}/{d.ml.ranks}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>CONTEST</span><span className="text-[#f4efe2]">{d.ml.contest === 'PENDING' ? `RE-GATE ${d.ml.regateWindows.length}/4` : d.ml.contest.replace(/_/g, ' ')}</span></div>
            {d.ml.humanWinShare !== null && <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>HUMAN SHARE</span><span className="text-[#e8cf46]">{(d.ml.humanWinShare * 100).toFixed(1)}%</span></div>}
            {d.ml.exit !== 'NONE' && <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>EXIT</span><span className="text-[#6ee7a0]">{d.ml.exit.replace(/_/g, ' ')}</span></div>}
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>SPEED</span><span className="text-[#f4efe2]">{d.ml.speed.toFixed(2)} m/s</span></div>
          </Panel>
        )}
        {d.phase === 'CHAOS_SCRIM' && d.chaos && (
          <Panel title="CHAOS SCRIMMAGE">
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>BODIES</span><span className="text-[#f4efe2]">{d.chaos.pool.length} (7v7)</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>BALL</span><span className="text-[#6ee7a0]">{d.chaos.ballState}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>CONTACTS</span><span className="text-[#f4efe2]">{d.chaos.contacts}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>DIVES</span><span className="text-[#f4efe2]">{d.chaos.dives}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>FPS</span><span className={d.chaosFps >= 60 ? 'text-[#6ee7a0]' : 'text-[#ffd76a]'}>{d.chaosFps || '—'}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]">
              <span>PHYSICS</span>
              <span className={d.chaos.physicsReady ? 'text-[#6ee7a0]' : d.chaos.physicsError ? 'text-[#ff6a5a]' : 'text-[#ffd76a]'}>
                {d.chaos.physicsReady ? `TARCS ${d.chaos.physics?.lastStepMs.toFixed(1)} MS` : d.chaos.physicsError || 'BOOTING'}
              </span>
            </div>
          </Panel>
        )}
        {d.phase === 'OPEN_PLAY' && d.op && density !== 'MINIMAL' && ctrlTeam(d) === d.op.attacking && (
          <Panel title="OPEN PLAY">
            <div className="h-2 w-full border border-[#3d4b66] bg-[#0a0e16]">
              <div className="h-full" style={{
                width: `${d.op.pressure * 100}%`,
                background: d.op.pressure > 0.66 ? '#ff6a5a' : d.op.pressure > 0.34 ? '#e8cf46' : '#6ee7a0',
              }} />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-[#7f8ea6]">
              <span>{d.op.toLine.toFixed(0)} m TO THE LINE</span>
              <span className={d.op.lineBreak ? 'text-[#6ee7a0]' : ''}>{d.op.lineBreak ? 'LINE BREAK' : `+${d.op.gained.toFixed(1)} m`}</span>
            </div>
            {d.passOpts.length > 0 && (
              <div className="mt-1 text-[8px] leading-tight text-[#7f8ea6]">
                PASS OPTIONS: {d.passOpts.map((o) => `${o.player.num} (${(100 - o.risk * 100).toFixed(0)}%)`).join(' · ')}
              </div>
            )}
          </Panel>
        )}
      </div>

      {/* COMMENTARY: a two-hander, because that is why it worked */}
      {(d.options.commentary ?? 2) > 0 && (
        <div className="pointer-events-none absolute bottom-[104px] left-1/2 w-[min(700px,74%)] -translate-x-1/2">
          <div className="border-2 border-[#e8cf46] bg-[#0d1220]/95 px-3 py-1 text-center">
            <div className="text-[11px] font-black leading-tight tracking-[0.04em] text-[#f4efe2]">{d.feed[0]?.text ?? 'AND WE ARE UNDER WAY'}</div>
            {d.feed[0]?.text2 && <div className="text-[10px] leading-tight text-[#c9a94a]">{d.feed[0].text2}</div>}
          </div>
          {d.refSignal > 0 && (
            <div className="mt-1 border-2 border-[#c8402f] bg-[#2a1420]/95 px-3 py-0.5 text-center text-[10px] font-black tracking-[0.2em] text-[#ffb0a0]">
              REFEREE: {d.refSignalText}
            </div>
          )}
        </div>
      )}

      {/* PHASE NARRATIVE — what is happening now, and what to do next.
          This is the answer to "there is no sense of what is going on after a
          tackle". It is always on screen and always current. */}
      {(() => {
        const n = d.narrative;
        return (
          <div className="pointer-events-none absolute bottom-3 left-1/2 w-[min(620px,80%)] -translate-x-1/2">
            <div className={`border-2 bg-[#0d1220]/96 px-4 py-1.5 ${n.danger ? 'border-[#ff6a5a]' : 'border-[#3d4b66]'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[12px] font-black tracking-[0.04em] ${n.danger ? 'text-[#ff6a5a]' : 'text-[#f4efe2]'}`}>
                  {n.now}
                </span>
                {n.clock > 0 && (
                  <span className={`shrink-0 text-[11px] font-black tabular-nums ${n.danger ? 'text-[#ff6a5a]' : 'text-[#e8cf46]'}`}>
                    {n.clock.toFixed(1)}s
                  </span>
                )}
              </div>
              {n.next && <div className="text-[10px] leading-tight text-[#6ee7a0]">▸ {n.next}</div>}
              <div className="mt-0.5 border-t border-[#26314a] pt-0.5 text-[9px] tracking-[0.08em] text-[#7f8ea6]">
                {commandBar() || 'A/D RUN · SPACE SPRINT'}
              </div>
            </div>
          </div>
        );
      })()}

      {/* TACTIC CHIP */}
      <div className="pointer-events-none absolute bottom-3 left-3">
        <div className="border-2 border-[#3d4b66] bg-[#0d1220]/95 px-3 py-1 text-[9px] tracking-[0.14em] text-[#8fa0b8]">
          <span className="text-[#e8cf46]">{A.nation.short}</span> {A.backline.replace('BL-', '')}/{A.defence.replace('DF-', '')} ·
          W {A.sliders.find((s) => s.id === 'width')?.v} T {A.sliders.find((s) => s.id === 'tempo')?.v} K {A.sliders.find((s) => s.id === 'kickFreq')?.v}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 text-right text-[9px] text-[#7f8ea6]">
        <div><Kbd>ESC</Kbd> PAUSE · <Kbd>TAB</Kbd> STATS · <Kbd>R</Kbd> REPLAY · <Kbd>C</Kbd> SMOTHER · WHEEL ZOOM</div>
        <div className="mt-0.5"><Kbd>1–9 / 0 / - / =</Kbd> ROLE LOCK · <Kbd>SHIFT+1/2/3</Kbd> SHIRTS 13–15 · <Kbd>Q</Kbd> EMERGENCY SWITCH</div>
        {/* SPEC_25 — the catch and the punt, on the one surface a player reads. The
            window is printed because 300 ms is not a number anyone can feel, and a
            control that fails silently reads as a broken game. */}
        <div className="mt-0.5">
          <Kbd>RMB</Kbd> HANDS UP · <Kbd>LMB</Kbd> SECURE · RELEASE <Kbd>LMB</Kbd> DROP ·{' '}
          <Kbd>SPACE</Kbd> PUNT IN{' '}
          <span className={d.bc.state === 'DROP_BALL' ? 'text-[#ffd76a]' : 'text-[#5f6f86]'}>
            {(d.bc.window * 1000).toFixed(0)} MS
          </span>
        </div>
        <div className="mt-0.5 text-[#5f6f86]">GAMEPAD: STICK MOVE · <Kbd>A</Kbd> ACTION · <Kbd>X</Kbd>/<Kbd>Y</Kbd> PASS · <Kbd>B</Kbd> TACKLE · <Kbd>RB</Kbd> KICK</div>
        <div className="mt-0.5">GAME SPEED {Math.round(slow * 100)}% — <button className="pointer-events-auto text-[#e8cf46]" onClick={() => setSlow(slow === 1 ? 0.75 : slow === 0.75 ? 0.5 : slow === 0.5 ? 0.35 : 1)}>CHANGE</button></div>
        {showAnimDebug && <div className="mt-0.5 text-[#ffd76a]"><Kbd>B</Kbd> FACING/STRAFE DEBUG ON — TOGGLE</div>}
        {showTarcs && <div className="mt-0.5 text-[#ffd76a]"><Kbd>F3</Kbd> TARCS TELEMETRY ON — TOGGLE</div>}
      </div>

      {/* STATS */}
      {showStats && (
        <div className="pointer-events-auto absolute right-3 top-3 w-[300px]">
          <Panel title="LIVE STATISTICS">
            <div className="grid grid-cols-[46px_1fr_46px] gap-x-2 text-[10px]">
              {([
                ['TACKLES', 'tackles'], ['TURNOVERS', 'turnovers'], ['JACKALS', 'jackals'],
                ['SCRUMS WON', 'scrumsWon'], ['LINEOUTS WON', 'lineoutsWon'], ['RUCKS', 'rucks'],
                ['SLOW BALL', 'slowBall'], ['PASSES', 'passes'], ['KICKS', 'kicks'],
                ['CARRIES', 'carries'], ['LINE BREAKS', 'lineBreaks'], ['TACKLES BEAT', 'tacklesBroke'],
                ['OFFLOADS', 'offloads'], ['OFFSIDES', 'offsides'], ['PENALTIES', 'penaltiesConceded'],
              ] as const).map(([label, key]) => <StatRow key={key} label={label} a={A.stats[key]} b={B.stats[key]} />)}
            </div>
            <div className="mt-2 border-t border-[#26314a] pt-1 text-[9px] tracking-[0.08em] text-[#7f8ea6]">
              SET-PIECE EVENTS · SCRUMS {d.setPieceEvents.scrums} · LINEOUTS {d.setPieceEvents.lineouts}
            </div>
            <div className="mt-2 flex justify-end"><Btn small onClick={() => setShowStats(false)}>CLOSE</Btn></div>
          </Panel>
        </div>
      )}

      {/* AAA BROADCAST — matchday intro, player spotlight, controller badge */}
      {(d.options.broadcast ?? 1) >= 1 && <PlayerSpotlight d={d} />}
      <GamepadBadge connected={gp.connected} name={gp.name} />

      {/* SPEC_24 — the conditions the simulation is actually playing in, the
        * season form behind the fixture, and the two moments a broadcast never
        * shows in a sprite game: the TMO card and the sending-off. */}
      {(d.options.broadcast ?? 1) >= 1 && (
        <div className="pointer-events-none absolute left-1/2 top-[58px] -translate-x-1/2">
          <ConditionsStrip d={d}
            cond={condRef.current ?? conditionsFor(d.options, qualityFor(d.options))} />
        </div>
      )}
      {(d.options.broadcast ?? 1) >= 1 && <FormStrip d={d} />}
      {(d.options.broadcast ?? 1) >= 1 && <TmoCard d={d} />}
      {(d.options.broadcast ?? 1) >= 1 && <CardCard d={d} />}
      {(d.options.broadcast ?? 1) >= 1 && <ReplayFrame d={d} />}
      {!load && intro && (d.options.broadcast ?? 1) >= 1 && <MatchIntro d={d} />}

      {/* BOOT NOTICE — shown only when the boot was cut off at a stage that never
          finished. It is the difference between "the game is slow today" and a silent
          degradation nobody can explain, so it says what stopped, what is running
          instead, and how to make it stop nagging. It is dismissed by the same
          controls the render-health chip uses, and it survives until the next boot
          because a player needs to be able to read it after the kick-off they just
          missed. */}
      {bootStall && (
        <div className="pointer-events-auto absolute left-1/2 top-[92px] -translate-x-1/2 border-2 border-[#e8cf46] bg-[#0d1220]/96 px-3 py-1.5 text-[10px] leading-snug tracking-[0.1em] text-[#e8cf46]">
          <span className="font-black">BOOT CUT SHORT</span>
          <span className="text-[#9fb0c8]"> — “{bootStall}” never finished. The match is playing on
            the fallback layer{renderHealth.bodies === 'standin' ? ' with procedural bodies' : ''}.
            {' '}A slow link explains it; <span className="text-[#e8cf46]">RELOAD</span> once the link settles.
            <button className="ml-2 border border-[#3d4b66] px-1 text-[9px] text-[#7f8ea6]"
              onClick={() => setBootStall(null)}>OK</button>
          </span>
        </div>
      )}

      {/* LOADING — covers the world build so the tab never appears frozen. */}
      {load && (
        <LoadingScreen
          stage={load.stage}
          progress={load.progress}
          homeName={A?.nation?.name}
          awayName={B?.nation?.name}
          venue={d?.options?.timeofday === 3 ? 'UNDER LIGHTS' : undefined}
        />
      )}

      {/* PAUSE / HALF TIME / FULL TIME */}
      {(d.paused || d.over) && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-auto bg-black/75 p-6">
          {d.over ? (
            <div className="w-full max-w-3xl">
              <Panel title="FULL TIME">
                <div className="text-center text-4xl font-black text-[#f4efe2]">{A.nation.short} {A.score} — {B.score} {B.nation.short}</div>
                <div className="mt-1 text-center text-[10px] tracking-[0.3em] text-[#7f8ea6]">
                  {A.score === B.score ? 'HONOURS EVEN' : A.score > B.score ? `${A.nation.name} TAKE IT` : `${B.nation.name} TAKE IT`}
                </div>
                {objective && (
                  <div className="mt-2 border-2 border-[#e8cf46] bg-[#161a10] p-2 text-center">
                    <div className="text-[10px] tracking-[0.2em] text-[#7f8ea6]">SCENARIO OBJECTIVE</div>
                    <div className="text-[13px] font-black text-[#e8cf46]">{objective.name} — {objective.target}</div>
                    {(() => {
                      const mine = cfg.homeId === A.nation.id ? A.score : B.score;
                      const theirs = cfg.homeId === A.nation.id ? B.score : A.score;
                      const ok = mine - theirs >= objective.margin;
                      return (
                        <div className={`mt-1 text-[13px] font-black ${ok ? 'text-[#6ee7a0]' : 'text-[#ff6a5a]'}`}>
                          {ok ? 'HISTORY REWRITTEN' : 'THE RECORD STILL STANDS'} · MARGIN {mine - theirs}
                        </div>
                      );
                    })()}
                  </div>
                )}
                <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2">
                  {([['A', A, '#e2664f'], ['B', B, '#7fa3e6']] as const).map(([k, T, col]) => (
                    <div key={k} className="border border-[#26314a] p-2">
                      <div className="font-black" style={{ color: col }}>{T.nation.short} TOP THREE</div>
                      {[...T.players].sort((x, y) => (y.tackles + y.carries + y.breaks * 3 + y.metres / 20) - (x.tackles + x.carries + x.breaks * 3 + x.metres / 20)).slice(0, 3)
                        .map((p) => (
                          <div key={p.num} className="text-[#cfd8e6]">
                            {p.num} {p.name} · {p.carries} CARRIES / {p.tackles} TACKLES{p.breaks ? ` / ${p.breaks} BREAKS` : ''}
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
                <div className="mt-3 max-h-40 overflow-auto border border-[#26314a] p-2 text-[10px] text-[#a9b6c8]">
                  {d.events.length === 0 && <div className="text-[#6f7f96]">A TRYLESS GRIND. NO SCORE EVENTS.</div>}
                  {d.events.slice().reverse().map((e, i) => (
                    <div key={i} className="grid grid-cols-[36px_1fr] gap-2">
                      <span className="tabular-nums text-[#6f7f96]">{e.min}'</span>
                      <span className={e.team === 'A' ? 'text-[#e2664f]' : e.team === 'B' ? 'text-[#7fa3e6]' : ''}>{e.text}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-end"><Btn onClick={() => onFinish({ a: A.score, b: B.score, events: d.events })}>CONTINUE</Btn></div>
              </Panel>
            </div>
          ) : d.clock === 0 && d.half === 2 ? (
            <div className="w-full max-w-2xl">
              <Panel title="HALF TIME">
                <div className="text-center text-3xl font-black text-[#f4efe2]">{A.nation.short} {A.score} — {B.score} {B.nation.short}</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
                  <div className="space-y-1">
                    <div className="font-black tracking-[0.2em] text-[#e8cf46]">COACH REPORT</div>
                    <div className="text-[#a9b6c8]">
                      {A.stats.slowBall / Math.max(1, A.stats.rucks) > 0.34
                        ? 'Our ball is too slow. Commit more at the breakdown or go wide sooner.'
                        : 'Our recycle is quick enough — the wide channels are there.'}
                    </div>
                    <div className="text-[#a9b6c8]">
                      {A.stats.penaltiesConceded > B.stats.penaltiesConceded
                        ? 'We are giving too much away at the breakdown. Drop the aggression.'
                        : 'Discipline has been good. Hold it.'}
                    </div>
                    {A.stats.tacklesBroke > 3 && <div className="text-[#a9b6c8]">We are beating defenders but not finishing. Use the overlap.</div>}
                  </div>
                  <div className="space-y-1">
                    <div className="font-black tracking-[0.2em] text-[#e8cf46]">KEY NUMBERS</div>
                    <div className="text-[#cfd8e6]">TACKLES {A.stats.tackles}–{B.stats.tackles}</div>
                    <div className="text-[#cfd8e6]">TURNOVERS {A.stats.turnovers}–{B.stats.turnovers}</div>
                    <div className="text-[#cfd8e6]">LINEOUT WINS {A.stats.lineoutsWon}–{B.stats.lineoutsWon}</div>
                    <div className="text-[#cfd8e6]">SET-PIECE EVENTS S {d.setPieceEvents.scrums} · L {d.setPieceEvents.lineouts}</div>
                    <div className="text-[#cfd8e6]">LINE BREAKS {A.stats.lineBreaks}–{B.stats.lineBreaks}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="border border-[#26314a] p-2">
                    <div className="mb-1 text-[9px] font-black tracking-[0.2em] text-[#7f8ea6]">FRONT ROW GAS — BENCH {A.subsUsed}/{['0', '2', '3', '5', '7'][d.options.subs ?? 2]}</div>
                    {[...A.players].slice(0, 8).sort((x, y) => {
                      const fx = d.live.find((p) => p.team === 'A' && p.num === x.num)?.stamina ?? 100;
                      const fy = d.live.find((p) => p.team === 'A' && p.num === y.num)?.stamina ?? 100;
                      return fx - fy;
                    }).slice(0, 4).map((p) => {
                      const st = d.live.find((q) => q.team === 'A' && q.num === p.num)?.stamina ?? 100;
                      return (
                        <div key={p.num} className="flex items-center justify-between border border-[#26314a] px-2 py-1 text-[9px]">
                          <span className="text-[#cfd8e6]">{p.num} {p.name.split(' ').slice(-1)[0]}</span>
                          <span className="tabular-nums text-[#7f8ea6]">{Math.round(st)}%</span>
                          <Btn small onClick={() => { d.makeSub('A', p.num); force((n) => n + 1); }}>SUB</Btn>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border border-[#26314a] p-2 text-[9px] text-[#7f8ea6]">
                    <div className="mb-1 font-black tracking-[0.2em] text-[#7f8ea6]">DESIGNATED KICKER</div>
                    <div className="text-[#cfd8e6]">{A.players[A.kicker - 1].name} — SHIRT {A.kicker}</div>
                    <div className="mt-1">Every goal kick is taken by this man. Change him on the squad sheet.</div>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Btn danger onClick={onExit}>ABANDON</Btn>
                  <Btn onClick={() => d.resumeSecondHalf()}>SECOND HALF</Btn>
                </div>
              </Panel>
            </div>
          ) : (
            <div className="w-full max-w-2xl">
              <Panel title="PAUSED">
                <div className="text-center text-2xl font-black text-[#f4efe2]">{A.nation.short} {A.score} — {B.score} {B.nation.short}</div>
                <div className="mt-1 text-center text-[10px] tracking-[0.24em] text-[#7f8ea6]">{d.clockText} · {d.half === 1 ? 'FIRST HALF' : 'SECOND HALF'}</div>
                <div className="mt-3 text-center text-[10px] leading-relaxed text-[#a9b6c8]">
                  {d.hint || `YOU ARE ${ctrl ? `CONTROLLING ${ctrl.num} ${A.players[ctrl.num - 1]?.name ?? ''}` : 'IN PLAY'}. ${contract ? contract.job.OPEN_PLAY ?? 'SUPPORT THE CARRIER' : ''}`}
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Btn onClick={() => { d.paused = false; force((n) => n + 1); }}>RESUME</Btn>
                  <Btn onClick={() => { d.camMode = d.camMode === 'BROADCAST' ? 'CHASE' : d.camMode === 'CHASE' ? 'TACTICAL' : 'BROADCAST'; force((n) => n + 1); }}>CAMERA: {d.camMode}</Btn>
                  <Btn onClick={() => { d.options.radar = (d.options.radar ?? 1) === 1 ? 0 : 1; force((n) => n + 1); }}>RADAR {(d.options.radar ?? 1) === 1 ? 'ON' : 'OFF'}</Btn>
                  <Btn onClick={() => { d.options.autoSwitch = (d.options.autoSwitch ?? 0) === 1 ? 0 : 1; force((n) => n + 1); }}>AUTO SWITCH {(d.options.autoSwitch ?? 0) === 1 ? 'ON' : 'OFF'}</Btn>
                  <Btn onClick={() => { d.assists.pass = d.assists.pass > 0.5 ? 0.2 : 1; d.assists.tackle = d.assists.pass; d.assists.kick = d.assists.pass; force((n) => n + 1); }}>
                    ASSISTS {d.assists.pass > 0.5 ? 'ON' : 'OFF'}
                  </Btn>
                  <Btn onClick={() => { if (!d.phase.includes('REPLAY')) d.enterReplay('REPLAY'); }}>INSTANT REPLAY</Btn>
                  <Btn danger onClick={onExit}>QUIT TO MENU</Btn>
                </div>
                <CameraPanel d={d} force={force} />
                <SpaceRemap d={d} force={force} />
                {/* SPEC_07 (T-67 backstop): the scoreTry idempotence guard's
                    watchdog log. A blocked duplicate score trigger is shown
                    HERE — a silent guard-block is an unexplained score. The
                    watchdog trip count rides along because a trip near the
                    goal line is T-67's suspected double-score trigger. */}
                <div className="mt-3 border border-[#26314a] p-2">
                  <div className="font-black tracking-[0.2em] text-[#7f8ea6]">
                    SCORE GUARD — {d.tryGuardBlocks} DUPLICATE TRIGGER{d.tryGuardBlocks === 1 ? '' : 'S'} BLOCKED
                    {d.watchdogTrips > 0 ? ` · WATCHDOG TRIPS ${d.watchdogTrips}` : ''}
                  </div>
                  {d.tryGuardLog.length === 0 ? (
                    <div className="mt-1 text-[9px] text-[#6f7f96]">TRY LOCK CLEAN — NO DUPLICATE SCORE ATTEMPTS INTERCEPTED THIS MATCH.</div>
                  ) : (
                    <div className="mt-1 max-h-24 space-y-0.5 overflow-auto text-[9px] text-[#ff9d8c]">
                      {d.tryGuardLog.slice().reverse().map((l, i) => (
                        <div key={i} className="tabular-nums">{l}</div>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-[8px] tracking-[0.12em] text-[#6f7f96]">
                    LOCK ENGAGES THE FRAME A TRY IS AWARDED · CLEARS ON RESTART KICKOFF OR WATCHDOG RESET
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px] text-[#7f8ea6] sm:grid-cols-3">
                  {[
                    ['A/D', 'RUN'], ['SHIFT', 'SPRINT'], ['SPACE', 'CONTEXT ACTION'], ['J / K', 'PASS L / R'],
                    ['U / O', 'CUT-OUT'], ['E', 'DUMMY'], ['L', 'PUNT'],
                    ['H', 'GRUBBER'], ['P', 'DROP GOAL'], ['I', 'TAKE CONTACT'],
                    ['F', 'FEND'], ['G', 'STEP'], ['X', 'DIVING TACKLE'],
                    ['C', 'SMOTHER'], ['Q', 'SWITCH DEFENDER'], ['R', 'REPLAY'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between"><span className="text-[#e8cf46]">{k}</span><span>{v}</span></div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}

      {clinic && (
        <div className="pointer-events-auto absolute left-1/2 top-3 flex max-w-[90%] -translate-x-1/2 flex-wrap justify-center gap-1 border-2 border-[#e8cf46] bg-[#0d1220]/95 p-2">
          <span className="w-full text-center text-[9px] tracking-[0.24em] text-[#7f8ea6]">SKILLS CLINIC — SEVEN DRILLS, ONE PER VERB</span>
          <Btn small onClick={() => d.startScrum('A', 0, 0)}>SCRUM</Btn>
          <Btn small onClick={() => d.startLineout('A', 10, 8)}>LINEOUT</Btn>
          <Btn small onClick={() => d.startKick('A', 'GOAL', { x: 12, z: 32 })}>GOAL KICK WIDE</Btn>
          <Btn small onClick={() => d.startKick('A', 'GOAL', { x: 0, z: 38 })}>GOAL KICK FRONT</Btn>
          <Btn small onClick={() => d.startKick('A', 'PUNT', { x: 0, z: -20 })}>PUNT</Btn>
          <Btn small onClick={() => d.startKick('A', 'GRUBBER', { x: 0, z: 20 })}>GRUBBER</Btn>
          <Btn small onClick={() => d.startMaul('A', 0, 20, 5, true)}>MAUL</Btn>
          <Btn small onClick={() => d.startOpen('A', 0, -10, 13, 1)}>RUN AND PASS</Btn>
        </div>
      )}
      </div>{/* end HUD wrapper (z-10) */}

      <TutorialOverlay d={d} force={force} onExit={onExit} />
      <span className="hidden">{tick}</span>
    </div>
  );
}

/* ---- centre reticle: aim, focus/sprint sizing, green interaction state ---- */
export function centerReticleState(d: Director, held: ReadonlySet<string>, playerCamera = false) {
  const c = d.ctrlPlayer;
  const speed = c ? Math.hypot(c.vx, c.vz) : 0;
  const sprinting = held.has('shift') || speed > 6.2;
  const focused = held.has('mouse2') || held.has('n') || playerCamera && !sprinting;
  const radius = focused ? 7 : sprinting ? 17 : 11;
  const aim = d.reticleAimPoint();
  let green = false;
  if (c) {
    if (d.bc.free) {
      green = Math.hypot(d.bc.free.x - aim.x, d.bc.free.z - aim.z) <= 1.5;
    }
    if (d.op) {
      const carrier = d.L(d.op.attacking, d.op.carrierNum);
      const toAim = Math.hypot(carrier.x - aim.x, carrier.z - aim.z);
      const toPlayer = Math.hypot(carrier.x - c.x, carrier.z - c.z);
      /* Green means the centre ray is over a legal pickup or a defender in
       * the same 3.5 m dive envelope — not merely that an opponent exists. */
      green = green || (toAim <= 1.8 && toPlayer <= 3.5 && carrier.team !== c.team);
      green = green || (toAim <= 1.5 && carrier.team === c.team);
    }
  }
  return { radius, green, focused, sprinting };
}

/* ---- in-world indicators: pass target, tackle range, kick aim ---- */
function ctrlTeam(d: Director): 'A' | 'B' | null {
  return d.ctrlPlayer ? d.ctrlPlayer.team : null;
}

/**
 * A pass or kick in the air, drawn as a ball — not a marker. The engine gives
 * the renderer a proper flight body, but a 13 m/s throw can cross the frame in
 * half a second and, in player view (FPV/3rd), vanish behind a shoulder or a
 * hand. So while a ball is genuinely airborne we draw it on the HUD layer as a
 * white rugby ball with a short fading motion trail: enough afterimage that the
 * eye reads a thrown object and follows it to the hands, which is the whole
 * difference between "a ball" and "an indicator that something happened".
 */
function drawBallFlight(ctx: CanvasRenderingContext2D, d: Director, v: { w: number; h: number },
  trail: { x: number; y: number; z: number }[]) {
  const cam = { ...d.cam, shake: 0 };
  /* A ball is in a real throw only while it is detached from every hand. */
  let pt: { x: number; y: number; z: number } | null = null;
  if (d.phase === 'OPEN_PLAY' && d.op && d.op.ball.live) {
    pt = { x: d.op.ball.x, y: d.op.ball.y ?? 0, z: d.op.ball.z };
  } else if ((d.phase === 'KICK' || d.phase === 'KICK_REPLAY') && d.kk && d.kk.stage === 'FLIGHT') {
    pt = { x: d.kk.bx, y: d.kk.by, z: d.kk.bz };
  }
  if (!pt) {
    trail.length = 0;
    return;
  }
  /* Sample only when it is actually moving, so a just-caught/held ball never
   * leaves a smear. */
  const last = trail[trail.length - 1];
  if (last) {
    const dist = Math.hypot(pt.x - last.x, pt.z - last.z) + Math.abs(pt.y - last.y);
    if (dist < 0.04) { /* stationary instant — drain and drop */ }
    else trail.push(pt);
  } else {
    trail.push(pt);
  }
  if (trail.length > 7) trail.shift();

  /* Shadow under the flight so the height reads against the turf. */
  if (pt.y > 0.6) {
    const s = project(cam, v, pt.x, 0.04, pt.z);
    if (s) {
      ctx.fillStyle = 'rgba(6,9,14,0.25)';
      ctx.beginPath();
      ctx.ellipse(s.sx, s.sy, Math.max(3, s.sc * 0.10), Math.max(1.6, s.sc * 0.04), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* The fading afterimage follows behind the ball's live point. */
  const n = trail.length;
  for (let i = 0; i < n - 1; i++) {
    const p = trail[i];
    const t = project(cam, v, p.x, p.y, p.z);
    if (!t) continue;
    const k = (i + 1) / n;                 // 0 old -> ~1 newest
    ctx.globalAlpha = 0.10 + k * 0.16;
    ctx.fillStyle = '#fff6df';
    ctx.beginPath();
    ctx.arc(t.sx, t.sy, Math.max(2.5, t.sc * (0.06 * k + 0.03)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* The ball itself: elongated along its travel so it reads as a thrown object,
   * with a seam and a rim light rather than a flat dot. */
  const cur = project(cam, v, pt.x, pt.y, pt.z);
  if (!cur) { trail.length = 0; return; }
  const prevP = trail.length > 1 ? project(cam, v, trail[trail.length - 2].x, trail[trail.length - 2].y, trail[trail.length - 2].z) : null;
  let ang = 0;
  if (prevP && (Math.abs(prevP.sx - cur.sx) + Math.abs(prevP.sy - cur.sy)) > 0.5) {
    ang = Math.atan2(cur.sy - prevP.sy, cur.sx - prevP.sx);
  }
  const rx = Math.max(6.5, cur.sc * 0.20);
  const ry = Math.max(4, cur.sc * 0.11);
  ctx.save();
  ctx.translate(cur.sx, cur.sy);
  ctx.rotate(ang);
  /* outline */
  ctx.fillStyle = '#2a2f3a';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + 1.2, ry + 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  /* body */
  const g = ctx.createLinearGradient(-rx, 0, rx, 0);
  g.addColorStop(0, '#f4f0e4');
  g.addColorStop(0.5, '#ffffff');
  g.addColorStop(1, '#dcd8cc');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  /* the two seams so it is unmistakably a rugby ball, not a dot */
  ctx.strokeStyle = 'rgba(30,34,42,0.75)';
  ctx.lineWidth = 1.4;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-rx * 0.82, sgn * ry * 0.34);
    ctx.lineTo(rx * 0.82, sgn * ry * 0.34);
    ctx.stroke();
  }
  ctx.restore();
}

function drawIndicators(ctx: CanvasRenderingContext2D, d: Director, v: { w: number; h: number }) {
  const cam = { ...d.cam, shake: 0 };

  // pass-target markers: you always know who you are passing to
  // (playtest P3.9: only ever drawn on the HUMAN side's teammates)
  if (d.phase === 'OPEN_PLAY' && d.passOpts.length && d.op && ctrlTeam(d) === d.op.attacking
    && d.isHuman(d.op.attacking)) {
    for (const o of d.passOpts) {
      const p = project(cam, v, o.player.x, 0.02, o.player.z);
      if (!p) continue;
      const r = Math.max(7, p.sc * 0.36);
      ctx.strokeStyle = '#6ee7a0';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.ellipse(p.sx, p.sy, r, r * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '900 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,14,20,0.9)';
      ctx.strokeText(`${o.side < 0 ? 'J' : 'K'}${o.cutOut ? '·U/O' : ''} ${o.player.num}`, p.sx, p.sy - r * 0.9);
      ctx.fillStyle = '#6ee7a0';
      ctx.fillText(`${o.side < 0 ? 'J' : 'K'}${o.cutOut ? '·U/O' : ''} ${o.player.num}`, p.sx, p.sy - r * 0.9);
      ctx.textAlign = 'left';
    }
  }

  /* Playtest P3.9: the Q-switch was invisible — three rings mark the
   * defenders Q cycles through, the brightest on the one you control. */
  if (d.phase === 'OPEN_PLAY' && d.op && d.op.attacking !== ctrlTeam(d)) {
    const carP = d.live.find((q) => q.team === d.op!.attacking && q.num === d.op!.carrierNum);
    if (carP) {
      const cands = d.live
        .filter((q) => q.team === ctrlTeam(d) && q.sinbin <= 0 && !q.down)
        .sort((a, b) => Math.hypot(a.x - carP.x, a.z - carP.z) - Math.hypot(b.x - carP.x, b.z - carP.z))
        .slice(0, 3);
      for (const q of cands) {
        const p = project(cam, v, q.x, 0.02, q.z);
        if (!p) continue;
        const mine = q === d.ctrlPlayer;
        ctx.strokeStyle = mine ? '#6ee7a0' : 'rgba(110,231,160,0.45)';
        ctx.lineWidth = mine ? 3 : 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, Math.max(8, p.sc * 0.4), Math.max(3.2, p.sc * 0.16), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (mine) {
          ctx.font = '900 10px ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#6ee7a0';
          ctx.fillText('Q', p.sx, p.sy - Math.max(8, p.sc * 0.4) - 3);
          ctx.textAlign = 'left';
        }
      }
    }
  }

  // tackle range ring: exactly how far the dive reaches
  if (d.phase === 'OPEN_PLAY' && d.op) {
    const ctrl = d.ctrlPlayer;
    if (ctrl && ctrl.team !== d.op.attacking) {
      const p = project(cam, v, ctrl.x, 0.02, ctrl.z);
      if (p) {
        ctx.strokeStyle = 'rgba(255,106,90,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, p.sc * 3.5, p.sc * 1.4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /* KICK AIM LINE.
   * The line drawn on the grass IS the kick. Its length is the power you are
   * holding, and its end is where the ball will land. Hold longer, the line
   * grows. Release, and it goes there — give or take the kicker's accuracy,
   * which is drawn as the width of the landing ellipse. */
  if ((d.phase === 'KICK' || d.phase === 'KICK_REPLAY') && d.kk && (d.kk.stage === 'AIM' || d.kk.stage === 'METER')) {
    const s = d.kk;
    const a = project(cam, v, s.bx, 0.05, s.bz);
    const b = project(cam, v, s.landX, 0.05, s.landZ);
    const reach = Math.hypot(s.landX - s.bx, s.landZ - s.bz);
    if (a && b) {
      const power = Math.max(0.02, s.power);
      // The line thickens and brightens as power builds.
      ctx.strokeStyle = `rgba(255,215,106,${0.4 + power * 0.55})`;
      ctx.lineWidth = 2 + power * 5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.setLineDash([]);
      // Landing ellipse: wide when the kicker is inaccurate, tight when he is not.
      const acc = d.kickerAccuracy(s);
      const spread = 14 + (1 - acc) * 46;
      ctx.strokeStyle = acc > 0.75 ? '#6ee7a0' : acc > 0.5 ? '#ffd76a' : '#ff6a5a';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(b.sx, b.sy, spread, spread * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '900 12px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      const label = `${reach.toFixed(0)} m · ${(power * 100).toFixed(0)}% POWER`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(12,14,20,0.9)';
      ctx.strokeText(label, b.sx, b.sy - spread * 0.5 - 8);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(label, b.sx, b.sy - spread * 0.5 - 8);
      if (s.stage === 'AIM') {
        ctx.strokeText('HOLD SPACE TO BUILD POWER', b.sx, b.sy + spread * 0.5 + 16);
        ctx.fillStyle = '#6ee7a0';
        ctx.fillText('HOLD SPACE TO BUILD POWER', b.sx, b.sy + spread * 0.5 + 16);
      }
      ctx.textAlign = 'left';
    }
  }

  // controlled-player ring, drawn last so it is never hidden
  const c = d.ctrlPlayer;
  if (c) {
    const p = project(cam, v, c.x, 0.03, c.z);
    if (p) {
      ctx.strokeStyle = '#6ee7a0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, Math.max(9, p.sc * 0.44), Math.max(4, p.sc * 0.18), 0, 0, Math.PI * 2);
      ctx.stroke();
      /* T-52 SPRINT METER — the tank lives under the ring, on the pitch,
       * because that is where the player's eyes are when SHIFT runs dry.
       * Hidden while full; colour walks green -> amber -> red as it drains. */
      if (c.stamina < 99.5) {
        const bw = Math.max(9, p.sc * 0.44) * 1.7;
        const bx = p.sx - bw / 2;
        const by = p.sy + Math.max(4, p.sc * 0.18) + 4;
        ctx.fillStyle = 'rgba(12,14,20,0.78)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
        const st = Math.max(0, Math.min(100, c.stamina)) / 100;
        ctx.fillStyle = st > 0.5 ? '#6ee7a0' : st > 0.25 ? '#ffd76a' : '#ff6a5a';
        ctx.fillRect(bx, by, bw * st, 3);
      }
    }
  }
}

function StatRow({ label, a, b }: { label: string; a: number; b: number }) {
  const total = Math.max(1, a + b);
  return (
    <>
      <div className="text-right font-black tabular-nums text-[#e2664f]">{a}</div>
      <div>
        <div className="text-center text-[8px] tracking-[0.16em] text-[#7f8ea6]">{label}</div>
        <div className="flex h-1 w-full bg-[#0a0e16]">
          <div className="bg-[#c8402f]" style={{ width: `${(a / total) * 100}%` }} />
          <div className="bg-[#2f4f9c]" style={{ width: `${(b / total) * 100}%` }} />
        </div>
      </div>
      <div className="font-black tabular-nums text-[#7fa3e6]">{b}</div>
    </>
  );
}
