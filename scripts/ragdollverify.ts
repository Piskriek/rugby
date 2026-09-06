/**
 * RAGDOLL VERIFY — correctness and cost of the Verlet solver.
 *
 * A ragdoll is easy to get subtly wrong in ways that only show as "it looks
 * odd": limbs stretching, the body sinking through the turf, energy quietly
 * being injected until it explodes. Each of those is checked numerically here
 * so none of them needs an eyeball to catch.
 */
import { RagdollBody, RagdollPool, NODE, NODE_COUNT, STICK_COUNT, ITERATIONS, FIXED_STEP } from '../src/render/ragdoll';

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

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
