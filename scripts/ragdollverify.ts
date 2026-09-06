/**
 * RAGDOLL VERIFY — correctness and cost of the Verlet solver.
 *
 * A ragdoll is easy to get subtly wrong in ways that only show as "it looks
 * odd": limbs stretching, the body sinking through the turf, energy quietly
 * being injected until it explodes. Each of those is checked numerically here
 * so none of them needs an eyeball to catch.
 */
import { RagdollBody, RagdollPool, NODE, NODE_COUNT, STICK_COUNT, ITERATIONS, FIXED_STEP } from '../src/render/ragdollKernel';

/** A plausible standing pose, world metres, facing +Z. */
function standingSeed(x = 0, z = 0): Float32Array {
  const s = new Float32Array(NODE_COUNT * 3);
  const put = (n: number, px: number, py: number, pz: number) => {
    s[n * 3] = x + px; s[n * 3 + 1] = py; s[n * 3 + 2] = z + pz;
  };
  put(NODE.PELVIS, 0, 1.00, 0);
  put(NODE.CHEST, 0, 1.38, 0.02);
  put(NODE.HEAD, 0, 1.70, 0.04);
  put(NODE.SHOULDER_L, -0.20, 1.50, 0.01);
  put(NODE.SHOULDER_R, 0.20, 1.50, 0.01);
  put(NODE.HAND_L, -0.28, 1.05, 0.10);
  put(NODE.HAND_R, 0.28, 1.05, 0.10);
  put(NODE.KNEE_L, -0.11, 0.55, 0.02);
  put(NODE.KNEE_R, 0.11, 0.55, 0.02);
  put(NODE.FOOT_L, -0.11, 0.09, 0.00);
  put(NODE.FOOT_R, 0.11, 0.09, 0.00);
  return s;
}

let ok = true;
const check = (name: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
  if (!pass) ok = false;
};

const seed = standingSeed();
const restOf = (b: RagdollBody, a: number, c: number) => {
  const i = a * 3, j = c * 3;
  return Math.hypot(b.pos[j] - b.pos[i], b.pos[j + 1] - b.pos[i + 1], b.pos[j + 2] - b.pos[i + 2]);
};

/* ---- 1. limbs must not stretch ---- */
{
  const b = new RagdollBody();
  b.reset(seed, [0, 0, 7], [0, 1.5, -6], 3.0);   // a hard hit with spin
  const pairs: [number, number, string][] = [
    [NODE.PELVIS, NODE.CHEST, 'spine'],
    [NODE.KNEE_L, NODE.FOOT_L, 'shin'],
    [NODE.CHEST, NODE.SHOULDER_R, 'clavicle'],
  ];
  const rest0 = pairs.map(([a, c]) => restOf(b, a, c));
  let worst = 0;
  for (let f = 0; f < 300; f++) {
    b.update(1 / 60);
    pairs.forEach(([a, c], k) => {
      const err = Math.abs(restOf(b, a, c) - rest0[k]) / rest0[k];
      if (err > worst) worst = err;
    });
  }
  check('bones hold length under a hard hit', worst < 0.12, `worst stretch ${(worst * 100).toFixed(1)}%`);
}

/* ---- 2. the body must not sink through the turf ---- */
{
  const b = new RagdollBody();
  b.reset(seed, [0, 0, 6], [0, 0, -5], 0);
  let lowest = Infinity;
  for (let f = 0; f < 600; f++) { b.update(1 / 60); lowest = Math.min(lowest, b.lowestY()); }
  check('never penetrates the ground', lowest > -0.02, `lowest y = ${lowest.toFixed(4)} m`);
}

/* ---- 3. it must come to rest, not jitter or explode ---- */
{
  const b = new RagdollBody();
  b.reset(seed, [0, 0, 8], [0, 2, -7], 4);
  let frames = 0;
  while (!b.asleep && frames < 1200) { b.update(1 / 60); frames++; }
  check('settles and sleeps', b.asleep, `after ${(frames / 60).toFixed(2)} s`);
  const fin = b.lowestY();
  check('comes to rest lying down', b.pos[NODE.HEAD * 3 + 1] < 0.75,
    `head at ${b.pos[NODE.HEAD * 3 + 1].toFixed(2)} m, lowest ${fin.toFixed(3)}`);
}

/* ---- 4. energy must never grow (stability) ---- */
{
  const b = new RagdollBody();
  b.reset(seed, [0, 0, 9], [1, 2, -8], 6);
  let peak = 0, late = 0;
  for (let f = 0; f < 900; f++) {
    b.update(1 / 60);
    const m = b.motion();
    if (f < 60) peak = Math.max(peak, m);
    if (f > 600) late = Math.max(late, m);
  }
  check('energy decays, never injects', late < peak * 0.05,
    `peak ${peak.toExponential(2)} -> late ${late.toExponential(2)}`);
  let finite = true;
  for (let i = 0; i < NODE_COUNT * 3; i++) if (!Number.isFinite(b.pos[i])) finite = false;
  check('no NaN / infinity anywhere', finite, finite ? 'all finite' : 'DIVERGED');
}

/* ---- 5. extreme input must not break it ---- */
{
  const b = new RagdollBody();
  b.reset(seed, [0, 0, 60], [0, 40, -60], 50);   // absurd
  for (let f = 0; f < 400; f++) b.update(1 / 60);
  let finite = true;
  for (let i = 0; i < NODE_COUNT * 3; i++) if (!Number.isFinite(b.pos[i])) finite = false;
  check('survives an absurd impulse', finite && b.lowestY() > -0.05,
    finite ? `lowest ${b.lowestY().toFixed(3)} m` : 'DIVERGED');
}

/* ---- 6. a long frame hitch must not spiral ---- */
{
  const b = new RagdollBody();
  b.reset(seed, [0, 0, 5], [0, 1, -4], 1);
  const t0 = performance.now();
  b.update(2.0);                    // a 2 second stall
  const cost = performance.now() - t0;
  check('a 2 s hitch is clamped', cost < 5, `${cost.toFixed(2)} ms for one call`);
}

/* ---- 7. THE BUDGET ---- */
{
  const pool = new RagdollPool(4);
  const bodies: RagdollBody[] = [];
  for (let i = 0; i < 4; i++) {
    const h = pool.acquire()!;
    h.body.reset(standingSeed(i * 2, 0), [0, 0, 6], [0, 1.5, -5], 2);
    bodies.push(h.body);
  }
  // Warm up, then measure steady-state cost while all four are live.
  for (let f = 0; f < 30; f++) for (const b of bodies) b.update(1 / 60);
  const N = 2000;
  const t0 = performance.now();
  for (let f = 0; f < N; f++) {
    for (const b of bodies) { b.asleep = false; b.update(1 / 60); }
  }
  const ms = performance.now() - t0;
  const perFrame = ms / N;
  const budget = 16.67;
  check('4 bodies stay inside budget', perFrame < 0.35,
    `${perFrame.toFixed(4)} ms/frame (${(perFrame / budget * 100).toFixed(2)}% of 60 Hz)`);
  console.log(`      ${NODE_COUNT} particles, ${STICK_COUNT} sticks, ${ITERATIONS} iterations, ${(1 / FIXED_STEP).toFixed(0)} Hz`);
}

/* ---- 8. the pool must be a hard cap ---- */
{
  const pool = new RagdollPool(2);
  const a = pool.acquire(), b = pool.acquire(), c = pool.acquire();
  check('pool refuses to over-allocate', !!a && !!b && c === null, `active ${pool.active}/2`);
  pool.release(a!.id);
  check('released slots are reusable', pool.acquire() !== null, `active ${pool.active}/2`);
}

/* ---- 9. the bridge must actually resolve against the shipped rig ----
 * A ragdoll whose bone names do not match the GLB is silently inert: no
 * error, no crash, just a tackle that still looks canned. Parse the real
 * asset rather than trusting the naming table. */
{
  const fs = await import('node:fs');
  const buf = fs.readFileSync('public/assets/models/rugby_player.glb');
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const names = new Set<string>((gltf.nodes ?? [])
    .map((n: { name?: string }) => n.name).filter(Boolean));
  const want: Record<string, string[]> = {
    pelvis: ['pelvis', 'Hips', 'mixamorigHips'],
    spine1: ['spine_01', 'Spine', 'mixamorigSpine'],
    spine3: ['spine_03', 'Spine2', 'mixamorigSpine2'],
    neck: ['neck_01', 'Neck', 'mixamorigNeck'],
    head: ['head', 'Head', 'mixamorigHead'],
    upperArmL: ['upperarm_l', 'LeftArm', 'mixamorigLeftArm'],
    upperArmR: ['upperarm_r', 'RightArm', 'mixamorigRightArm'],
    foreArmL: ['lowerarm_l', 'LeftForeArm', 'mixamorigLeftForeArm'],
    foreArmR: ['lowerarm_r', 'RightForeArm', 'mixamorigRightForeArm'],
    thighL: ['thigh_l', 'LeftUpLeg', 'mixamorigLeftUpLeg'],
    thighR: ['thigh_r', 'RightUpLeg', 'mixamorigRightUpLeg'],
    calfL: ['calf_l', 'LeftLeg', 'mixamorigLeftLeg'],
    calfR: ['calf_r', 'RightLeg', 'mixamorigRightLeg'],
  };
  const missing = Object.entries(want)
    .filter(([, cands]) => !cands.some((c) => names.has(c)))
    .map(([k]) => k);
  check('every ragdoll bone resolves in the GLB', missing.length === 0,
    missing.length ? `MISSING: ${missing.join(', ')}` : '13/13 bones');
}

/* ---- 10. YAW INVARIANCE — the assumption the bake rests on ----------
 * The clip library stores no world direction: a fall is baked in body-local
 * space and rotated at playback. That is only legitimate if rotating the
 * inputs about Y rotates the result exactly. Gravity is the only external
 * axis and it is vertical, so it should hold — but if it ever stops holding
 * (a wind force, a directional ground effect) every baked tackle silently
 * starts pointing the wrong way. */
{
  const P = [[0,1.0,0],[0,1.35,0],[0,1.62,0],[-0.19,1.45,0],[0.19,1.45,0],
    [-0.30,1.05,0.10],[0.30,1.05,0.10],[-0.10,0.55,0],[0.10,0.55,0],
    [-0.10,0.09,0.04],[0.10,0.09,0.04]];
  const runYaw = (th: number): Float32Array => {
    const sd = new Float32Array(NODE_COUNT * 3);
    for (let i = 0; i < NODE_COUNT; i++) {
      const x = P[i][0], z = P[i][2];
      sd[i * 3] = x * Math.cos(th) - z * Math.sin(th);
      sd[i * 3 + 1] = P[i][1];
      sd[i * 3 + 2] = x * Math.sin(th) + z * Math.cos(th);
    }
    const b = new RagdollBody();
    b.reset(sd, [6 * Math.cos(th), 0, 6 * Math.sin(th)],
      [2.6 * Math.cos(th), 1.9, 2.6 * Math.sin(th)], 0.5);
    for (let f = 0; f < 100; f++) b.update(1 / 60);
    return b.pos;
  };
  const th = 1.1, base = runYaw(0), rot = runYaw(th);
  let mx = 0;
  for (let i = 0; i < NODE_COUNT; i++) {
    const x = base[i * 3], z = base[i * 3 + 2];
    mx = Math.max(mx,
      Math.abs(x * Math.cos(th) - z * Math.sin(th) - rot[i * 3]),
      Math.abs(base[i * 3 + 1] - rot[i * 3 + 1]),
      Math.abs(x * Math.sin(th) + z * Math.cos(th) - rot[i * 3 + 2]));
  }
  check('solver is yaw-invariant (bake is valid)', mx < 0.01, `max drift ${(mx * 1000).toFixed(2)} mm`);
}

/* ---- 11. the solver is deterministic ---------------------------------
 * Baking is only meaningful if the same inputs give the same fall. */
{
  const sd = new Float32Array(NODE_COUNT * 3);
  for (let i = 0; i < NODE_COUNT; i++) { sd[i * 3 + 1] = 1.6 - i * 0.12; }
  const run = (): number[] => {
    const b = new RagdollBody();
    b.reset(sd, [4, 0, 1], [2, 1.9, 0], 0.4);
    for (let f = 0; f < 80; f++) b.update(1 / 60);
    return Array.from(b.pos);
  };
  const a = run(), c = run();
  let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - c[i]));
  check('solver is deterministic', d === 0, `max diff ${d}`);
}

/* ---- 12. every baked clip is usable ----------------------------------
 * The baker rejects bad takes, but a corrupt decode or a truncated buffer
 * would surface as a fall that snaps to the origin or flies off. Check the
 * shipped library the way the runtime will actually read it. */
{
  const { RagdollPlayback, pickClip, CLIP_COUNT, CLIP_SECONDS } = await import('../src/render/ragdollClips');
  /* Clips store positions as a DELTA from the seed pelvis, so the origin must
   * be a realistic standing pelvis height (~1 m) for the absolute heights
   * below to mean anything. Passing y=0 would put every head underground and
   * a max() check would silently read 0. */
  let worstHead = -Infinity, worstTravel = 0, bad = 0;
  const play = new RagdollPlayback();
  for (let c = 0; c < CLIP_COUNT; c++) {
    play.start(c, 0.7, [10, 1.0, -5], 1);
    for (let t = 0; t < CLIP_SECONDS * 60; t++) play.update(1 / 60);
    for (let i = 0; i < play.pos.length; i++) if (!Number.isFinite(play.pos[i])) bad++;
    // pelvis y is index 1; head is node 2
    worstHead = Math.max(worstHead, play.pos[2 * 3 + 1]);
    worstTravel = Math.max(worstTravel,
      Math.hypot(play.pos[0] - 10, play.pos[2] + 5));
  }
  check('all baked clips decode finite', bad === 0, `${CLIP_COUNT} clips, ${bad} bad values`);
  check('all baked clips end on the ground', worstHead < 0.95 && worstHead > 0,
    `worst head ${worstHead.toFixed(2)} m above turf`);
  check('no baked clip slides absurdly', worstTravel < 7, `worst travel ${worstTravel.toFixed(1)} m`);

  /* Playback must be cheaper than solving, or the bake bought nothing. */
  const t0 = performance.now();
  for (let r = 0; r < 2000; r++) { play.start(r % CLIP_COUNT, 1.2, [0, 0, 0], 1); play.update(1 / 60); }
  const per = (performance.now() - t0) / 2000;
  check('playback is cheap', per < 0.02, `${per.toFixed(4)} ms per body per frame`);

  // selection must be stable and in range
  let inRange = true;
  for (let a = 0; a < 64; a++) {
    const i = pickClip((a / 64) * Math.PI * 2, 0.9, a);
    if (i < 0 || i >= CLIP_COUNT) inRange = false;
  }
  check('clip selection stays in range', inRange, 'all 64 headings resolve');
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
