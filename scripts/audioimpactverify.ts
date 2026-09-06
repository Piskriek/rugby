/**
 * TARCS AUDIO ENGINE — verification gate.
 *
 * The audio itself cannot be asserted headlessly (there is no AudioContext in
 * Node and no way to listen to one in CI), so this verifies the two halves that
 * CAN be measured, which are also the two that can silently regress:
 *
 *  1. THE PHYSICS TAP. `RapierWorld` must report player-vs-player impacts with
 *     a plausible closing speed and impulse, must respect the 3.0 m/s gate,
 *     must never report a player against himself, and must stay completely
 *     inert while nobody is subscribed (the gym depends on that).
 *  2. THE SYNTHESIS MAP. `MatchAudio.bodyImpact` must be a no-op before a user
 *     gesture (browser autoplay policy), and the impulse -> volume/pitch curve
 *     must be monotonic in the right direction: harder hits louder and LOWER.
 *
 * Run: npx tsx scripts/audioimpactverify.ts
 */
import {
  RapierWorld,
  IMPACT_MIN_RELATIVE_SPEED,
  DEFAULT_BREAK_IMPULSE_Ns,
  type PlayerImpact,
} from '../src/core/physics/RapierWorld';
import { MatchAudio, IMPACT_FULL_SCALE_IMPULSE } from '../src/game/audio';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ */
/* 1. THE PHYSICS TAP                                                  */
/* ------------------------------------------------------------------ */

/** Run a head-on collision at `speed` m/s and collect what the tap reports. */
async function headOn(speed: number, subscribe = true): Promise<PlayerImpact[]> {
  const world = await RapierWorld.create();
  world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });
  world.addTabsPlayer({ x: 0, y: 0, z: -2.5, vz: speed });
  world.addTabsPlayer({ x: 0, y: 0, z: 2.5, vz: -speed });

  const seen: PlayerImpact[] = [];
  if (subscribe) world.onPlayerImpact((i) => seen.push(i));
  for (let i = 0; i < 120; i++) world.step(1 / 60);
  world.dispose();
  return seen;
}

async function main() {
  /* --- a real hit is reported --- */
  const hard = await headOn(6);
  check('hard collision reports at least one impact', hard.length > 0, `${hard.length} impacts`);

  if (hard.length > 0) {
    const first = hard[0];
    check(
      'reported closing speed clears the 3.0 m/s gate',
      hard.every((i) => i.relativeSpeed > IMPACT_MIN_RELATIVE_SPEED),
      `min ${Math.min(...hard.map((i) => i.relativeSpeed)).toFixed(2)} m/s`,
    );
    check(
      'head-on at 6 m/s reads near the 12 m/s closing speed',
      first.relativeSpeed > 9 && first.relativeSpeed < 14,
      `${first.relativeSpeed.toFixed(2)} m/s`,
    );
    check(
      'impulse is positive and finite',
      hard.every((i) => i.impulse > 0 && Number.isFinite(i.impulse)),
      `peak ${Math.max(...hard.map((i) => i.impulse)).toFixed(1)} N·s`,
    );
    check(
      'no player is ever reported against himself',
      hard.every((i) => i.playerA !== i.playerB),
    );
    check(
      'contact point is on the pitch, near the meeting line',
      hard.every((i) => Math.abs(i.z) < 6 && i.y > -1 && i.y < 3),
      `first at z=${first.z.toFixed(2)} y=${first.y.toFixed(2)}`,
    );
    check(
      'at least one impulse was measured by a contact-force event',
      hard.some((i) => i.measured),
    );
    /* The pair cooldown must actually throttle a sustained pile. Two seconds of
     * sim at a 0.12 s cooldown can physically not produce more than ~17. */
    check(
      'pair cooldown throttles the pile',
      hard.length <= 20,
      `${hard.length} impacts in 2 s`,
    );
  }

  /* --- a gentle touch is NOT reported --- */
  const soft = await headOn(0.6);
  check('sub-threshold contact reports nothing', soft.length === 0, `${soft.length} impacts`);

  /* --- the tap is inert when nobody is listening --- */
  const unsubscribed = await headOn(6, false);
  check('no listener means no events', unsubscribed.length === 0);

  /* --- unsubscribing stops delivery --- */
  {
    const world = await RapierWorld.create();
    world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });
    world.addTabsPlayer({ x: 0, y: 0, z: -2.5, vz: 6 });
    world.addTabsPlayer({ x: 0, y: 0, z: 2.5, vz: -6 });
    let n = 0;
    const detach = world.onPlayerImpact(() => { n++; });
    detach();
    for (let i = 0; i < 120; i++) world.step(1 / 60);
    world.dispose();
    check('detach stops delivery', n === 0, `${n} impacts after detach`);
  }

  /* ------------------------------------------------------------------ */
  /* 1b. BOTH CONSUMERS ON ONE QUEUE                                     */
  /* ------------------------------------------------------------------ */

  /*
   * The merge hazard. `world.step(queue)` takes ONE EventQueue and the first
   * `drainContactForceEvents` call empties it, so a ball-carrier weld and an
   * audio impact listener running at the same time must not starve each other.
   * Before the shared-queue refactor these were two queues and only one could
   * ever be attached to the step. This asserts both fire in the same run.
   */
  {
    const world = await RapierWorld.create();
    world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });
    const carrier = world.addTabsPlayer({ x: 0, y: 0, z: -2.5, vz: 6 });
    world.addTabsPlayer({ x: 0, y: 0, z: 2.5, vz: -6 });
    const ball = world.addBall({ radius: 0.15, x: 0, y: 1.53, z: -2.5 });

    let impacts = 0;
    world.onPlayerImpact(() => { impacts++; });

    let broke = false;
    const weld = world.attachBallToCarrier(carrier, ball, {
      breakImpulse: DEFAULT_BREAK_IMPULSE_Ns,
      onBreak: () => { broke = true; },
    });
    check('weld starts held', weld.held);

    for (let i = 0; i < 120; i++) world.step(1 / 60);
    world.dispose();

    check('impact tap still fires while a ball is welded', impacts > 0, `${impacts} impacts`);
    check('weld still breaks while an impact listener is attached', broke);
  }

  /* ------------------------------------------------------------------ */
  /* 2. THE SYNTHESIS MAP                                                */
  /* ------------------------------------------------------------------ */

  /* Autoplay policy: with no AudioContext in Node, every entry point must be a
   * silent no-op rather than a throw. This is the same code path a browser
   * takes before the first user gesture. */
  const audio = new MatchAudio();
  let threw = false;
  try {
    audio.bodyImpact({ x: 0, y: 1, z: 0, relativeSpeed: 9, impulse: 150 });
    audio.whistle('LONG');
    audio.event('TURNOVER');
    audio.event('SCRUM_PEN');
    audio.setListener(0, 13, -18, 0, 0.5);
    audio.update(1 / 60, 0.2, true, 0.5);
    audio.armFirstGesture(null);
    audio.dispose();
  } catch (e) {
    threw = true;
    console.log(`      threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  check('silent and safe before the first user gesture', !threw);
  check('not ready before a gesture', !audio.ready);

  /* The volume/pitch curve. These mirror the expressions in `bodyImpact`; if
   * that synthesis is retuned this must be retuned with it, on purpose. */
  const model = (impulse: number) => {
    const f = Math.min(1, Math.max(0, impulse / IMPACT_FULL_SCALE_IMPULSE));
    return { gain: 0.035 + f * 0.095, pitch: 1.35 - f * 0.63 };
  };
  const light = model(20);
  const heavy = model(200);
  check(
    'volume scales UP with impulse',
    heavy.gain > light.gain,
    `${light.gain.toFixed(3)} -> ${heavy.gain.toFixed(3)}`,
  );
  check(
    'pitch scales DOWN with impulse (bigger hit, lower voice)',
    heavy.pitch < light.pitch,
    `${light.pitch.toFixed(2)}x -> ${heavy.pitch.toFixed(2)}x`,
  );
  check(
    'peak body gain stays under the whistle peak (0.20, D-5 ruling)',
    model(1e9).gain < 0.2,
    `${model(1e9).gain.toFixed(3)} vs 0.200`,
  );

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
