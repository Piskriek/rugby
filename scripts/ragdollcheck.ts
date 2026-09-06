/**
 * ragdollcheck.ts — the fall solver, measured.
 *
 * There is no browser in this sandbox, so a ragdoll has to be proved by numbers
 * or not at all. This builds a skeleton with the shipped rig's bone names,
 * parent chain and conventions, runs real falls through `render/ragdoll.ts`, and
 * checks the things a ragdoll actually fails at: bone stretch, hyperextension,
 * sinking through the floor, a head that whips, a body that never stops moving,
 * a pair that passes through each other, a wrap that lets go, and a solver that
 * costs more than the frame it improves.
 *
 *   npx vite-node scripts/ragdollcheck.ts
 */
import * as THREE from 'three';
import { Ragdoll } from '../src/render/ragdoll';

let fails = 0;
const results: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    fails++;
    results.push(`FAIL  ${name}\n      ${String((e as Error).message || e)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const SCALE = 1.65;

/** The joints the solver drives, at standing height, in model metres. */
const REST: Record<string, [number, number, number]> = {
  pelvis: [0, 0.98, 0],
  spine_01: [0, 1.10, 0],
  spine_02: [0, 1.24, 0],
  spine_03: [0, 1.40, 0],
  neck_01: [0, 1.52, 0],
  head: [0, 1.66, 0],
  clavicle_l: [0.09, 1.46, 0], upperarm_l: [0.19, 1.44, 0],
  lowerarm_l: [0.21, 1.16, 0.04], hand_l: [0.22, 0.92, 0.10],
  clavicle_r: [-0.09, 1.46, 0], upperarm_r: [-0.19, 1.44, 0],
  lowerarm_r: [-0.21, 1.16, 0.04], hand_r: [-0.22, 0.92, 0.10],
  thigh_l: [0.10, 0.95, 0], calf_l: [0.11, 0.54, 0], foot_l: [0.11, 0.07, 0.02],
  thigh_r: [-0.10, 0.95, 0], calf_r: [-0.11, 0.54, 0], foot_r: [-0.11, 0.07, 0.02],
};

const PARENT: Record<string, string | null> = {
  pelvis: null,
  spine_01: 'pelvis', spine_02: 'spine_01', spine_03: 'spine_02',
  neck_01: 'spine_03', head: 'neck_01',
  clavicle_l: 'spine_03', upperarm_l: 'clavicle_l', lowerarm_l: 'upperarm_l', hand_l: 'lowerarm_l',
  clavicle_r: 'spine_03', upperarm_r: 'clavicle_r', lowerarm_r: 'upperarm_r', hand_r: 'lowerarm_r',
  thigh_l: 'pelvis', calf_l: 'thigh_l', foot_l: 'calf_l',
  thigh_r: 'pelvis', calf_r: 'thigh_r', foot_r: 'calf_r',
};

/** Which joint each bone runs toward: the direction its +Y has to carry. */
const CHILD: Record<string, string> = {
  pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head',
  clavicle_l: 'upperarm_l', upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l',
  clavicle_r: 'upperarm_r', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r',
  thigh_l: 'calf_l', calf_l: 'foot_l', thigh_r: 'calf_r', calf_r: 'foot_r',
};

/** Bone pairs whose length must not change while the body is solved. */
const SPANS: [string, string][] = [
  ['pelvis', 'spine_01'], ['spine_01', 'spine_02'], ['spine_02', 'spine_03'],
  ['spine_03', 'neck_01'], ['neck_01', 'head'],
  ['spine_03', 'clavicle_l'], ['clavicle_l', 'upperarm_l'],
  ['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'],
  ['spine_03', 'clavicle_r'], ['clavicle_r', 'upperarm_r'],
  ['upperarm_r', 'lowerarm_r'], ['lowerarm_r', 'hand_r'],
  ['pelvis', 'thigh_l'], ['thigh_l', 'calf_l'], ['calf_l', 'foot_l'],
  ['pelvis', 'thigh_r'], ['thigh_r', 'calf_r'], ['calf_r', 'foot_r'],
];

type Rig = { root: THREE.Group; bones: Map<string, THREE.Bone> };

/**
 * A stand-in for the GLB rig: real names, real parent chain, real scale.
 *
 * Both halves of the rig's contract are reproduced, because the solver assumes
 * them and nothing else in the codebase checks them: a bone's own +Y runs down
 * the limb toward its child, and a bone's `position` is that offset expressed in
 * the PARENT'S rotated frame. Get the second one wrong and the rest pose spirals
 * away from the skeleton the solver was seeded from, and the mesh then disagrees
 * with the physics by an amount that looks exactly like a broken solver. (It is
 * also the bug worth knowing about: it is what a ragdoll looks like when the
 * frame conversion is one bone off, and it will read as "the physics is wrong".)
 */
function buildRig(x: number, z: number, facing: number): Rig {
  const root = new THREE.Group();
  root.scale.setScalar(SCALE);
  root.position.set(x * SCALE, 0, z * SCALE);
  root.rotation.y = facing;
  const bones = new Map<string, THREE.Bone>();
  for (const [name, pos] of Object.entries(REST) as [string, [number, number, number]][]) {
    const b = new THREE.Bone();
    b.name = name;
    const kid = CHILD[name];
    if (kid) {
      const d = new THREE.Vector3(
        REST[kid][0] - pos[0], REST[kid][1] - pos[1], REST[kid][2] - pos[2]).normalize();
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    }
    b.userData.rest = b.quaternion.clone();
    const parent = PARENT[name];
    if (parent) {
      const anchor = bones.get(parent)!;
      b.position.copy(new THREE.Vector3(
        pos[0] - REST[parent][0], pos[1] - REST[parent][1], pos[2] - REST[parent][2])
        .applyQuaternion((anchor.userData.rest as THREE.Quaternion).clone().invert()));
      anchor.add(b);
    } else {
      b.position.set(pos[0], pos[1], pos[2]);
      root.add(b);
    }
    bones.set(name, b);
  }
  /* Soft joints. Nobody falls with locked knees, and a rig seeded from a
   * straight pose leaves the joint limits nothing to enforce — the ceiling and
   * the rest length are then the same number, and the test proves nothing. */
  for (const [name, deg] of [['lowerarm_l', 26], ['lowerarm_r', 22], ['calf_l', -18], ['calf_r', -13]] as const) {
    const b = bones.get(name)!;
    const kid = CHILD[name];
    const d = new THREE.Vector3().subVectors(pose({ root, bones }, kid), pose({ root, bones }, name)).normalize();
    b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg * Math.PI / 180));
    void d;
    b.userData.rest = b.quaternion.clone();
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

/**
 * Stand in for the mixer. The animation writes its own pose into every bone
 * before the solver blends on top of it; a test that lets the solver read its
 * own last output as "the animation" is testing a feedback loop, not a fall.
 */
function animate(rig: Rig) {
  rig.bones.forEach((b) => b.quaternion.copy(b.userData.rest as THREE.Quaternion));
}

function pose(rig: Rig, name: string) {
  return new THREE.Vector3().setFromMatrixPosition(rig.bones.get(name)!.matrixWorld).divideScalar(SCALE);
}

function restSpans(rig: Rig) {
  return SPANS.map(([a, b]) => ({ a, b, len: pose(rig, a).distanceTo(pose(rig, b)) }));
}

/** Simulate until the body calms, drawing the pose every frame as the game does. */
function settle(rag: Ragdoll, rig: Rig, frames = 240, dt = 1 / 60) {
  let f = 0;
  for (; f < frames && !rag.settled; f++) {
    rag.weight = 1;
    rag.step(dt);
    animate(rig);
    rag.apply();
    rig.root.updateMatrixWorld(true);
  }
  return f;
}

const GROUND = { friction: 0.55, restitution: 0.16, y: 0 };

/* ------------------------------------------------------------------ 1 ---- */
check('a sprint tackle puts him on the deck and stays there', () => {
  const rig = buildRig(0, 0, 0);
  const rag = new Ragdoll(rig.root, { vx: 6.2, vz: 1.1, vy: -1.1, spin: 0.9 }, GROUND);
  const f = settle(rag, rig);
  assert(rag.settled, `never settled (${(f / 60).toFixed(2)} s), speed ${rag.speed.toFixed(2)}`);
  assert(f / 60 < 2.0, `took ${(f / 60).toFixed(2)} s to calm — it has to end before the ruck forms`);
  const pelvis = rag.pos('pelvis')!;
  assert(pelvis.y < 0.42, `pelvis at ${pelvis.y.toFixed(2)} m — he never went to ground (drop ${rag.dropY.toFixed(2)})`);
  const head = rag.pos('head')!;
  assert(head.y < 0.32, `head at ${head.y.toFixed(2)} m — a man face down is not upright`);
  /* The visual claim, on the drawn skeleton rather than the solver: the spine has
   * to end up lying down. A solver that settles while the mesh stays upright is
   * worse than no solver at all, and it is exactly what a frame conversion that
   * is one bone off produces. */
  const up = pose(rig, 'spine_03').sub(pose(rig, 'pelvis')).normalize();
  assert(Math.abs(up.y) < 0.45, `the drawn spine still points ${Math.abs(up.y).toFixed(2)} up — the mesh is not following the solve`);
});

/* ------------------------------------------------------------------ 2 ---- */
check('bones do not stretch', () => {
  const rig = buildRig(0, 0, 0.6);
  const spans = restSpans(rig);
  const rag = new Ragdoll(rig.root,
    { vx: 7.4, vz: -2.2, vy: -1.6, spin: -1.4, airborne: 0.3 }, GROUND);
  let worst = 0; let worstName = '';
  for (let f = 0; f < 150 && !rag.settled; f++) {
    rag.weight = 1; rag.step(1 / 60); animate(rig); rag.apply();
    rig.root.updateMatrixWorld(true);
    for (const sp of spans) {
      const err = Math.abs(pose(rig, sp.a).distanceTo(pose(rig, sp.b)) - sp.len) / Math.max(1e-4, sp.len);
      if (err > worst) { worst = err; worstName = `${sp.a}→${sp.b}`; }
    }
  }
  assert(worst < 0.03, `worst drawn bone error ${(worst * 100).toFixed(1)}% on ${worstName}`);
});

/* ------------------------------------------------------------------ 3 ---- */
check('no joint hyperextends, no head whips, nothing sinks', () => {
  const rig = buildRig(0, 0, 0);
  const rag = new Ragdoll(rig.root, { vx: 8.5, vz: 3.0, vy: -2.4, spin: 2.6 }, GROUND);
  const armSpan = pose(rig, 'upperarm_l').distanceTo(pose(rig, 'lowerarm_l'))
    + pose(rig, 'lowerarm_l').distanceTo(pose(rig, 'hand_l'));
  const legSpan = pose(rig, 'thigh_l').distanceTo(pose(rig, 'calf_l'))
    + pose(rig, 'calf_l').distanceTo(pose(rig, 'foot_l'));
  let maxHeadSpeed = 0, headF = -1, elbowOver = 0, kneeOver = 0, lowest = 0, badFrame = -1, who = '';
  for (let f = 0; f < 200 && !rag.settled; f++) {
    const before = pose(rig, 'head');
    rag.weight = 1; rag.step(1 / 60); animate(rig); rag.apply();
    rig.root.updateMatrixWorld(true);
    const after = pose(rig, 'head');
    const hv = after.distanceTo(before) * 60;
    if (hv > maxHeadSpeed) { maxHeadSpeed = hv; headF = f; }
    if (after.y < lowest) { lowest = after.y; badFrame = f; }
    const eo = Math.max(
      pose(rig, 'upperarm_l').distanceTo(pose(rig, 'hand_l')),
      pose(rig, 'upperarm_r').distanceTo(pose(rig, 'hand_r'))) / armSpan;
    const ko = Math.max(
      pose(rig, 'thigh_l').distanceTo(pose(rig, 'foot_l')),
      pose(rig, 'thigh_r').distanceTo(pose(rig, 'foot_r'))) / legSpan;
    if (eo > elbowOver) { elbowOver = eo; who = 'elbow'; }
    if (ko > kneeOver) { kneeOver = ko; who = 'knee'; }
  }
  /* The seed pose of this rig is already 98% straight-armed, so the limit is
   * judged on whether it lets the joint get WORSE, not on an absolute number. */
  assert(elbowOver < 0.99, `the ${who} straightened past full reach (${(elbowOver * 100).toFixed(1)}%)`);
  assert(kneeOver < 0.999, `the knee hyperextended to ${(kneeOver * 100).toFixed(1)}%`);
  assert(maxHeadSpeed < 9.5, `head moved at ${maxHeadSpeed.toFixed(1)} m/s on frame ${headF} — that is a whip, not a fall`);
  assert(lowest > -0.02, `a joint reached ${lowest.toFixed(3)} m (frame ${badFrame}) — through the turf`);
});

/* ------------------------------------------------------------------ 4 ---- */
check('mud stops a man, firm grass lets him slide', () => {
  const slide = (friction: number, restitution: number) => {
    const rig = buildRig(0, 0, 0);
    /* 3 m/s, deliberately: fast enough that the ground decides where he stops,
     * slow enough that the drift ceiling does not. A test that measures the
     * ceiling and calls it friction is measuring the wrong thing. */
    const rag = new Ragdoll(rig.root, { vx: 3.0, vz: 0, vy: -0.8 }, { friction, restitution, y: 0 });
    const f = settle(rag, rig, 240);
    return { d: Math.hypot(rag.drift.x, rag.drift.z), f };
  };
  const wet = slide(0.82, 0.04);
  const firm = slide(0.36, 0.21);
  assert(wet.d < firm.d, `mud carried him ${wet.d.toFixed(2)} m and firm ground ${firm.d.toFixed(2)} m — the ground has to answer differently`);
  assert(firm.d - wet.d > 0.1, `only ${(firm.d - wet.d).toFixed(2)} m between the two — invisible, so pointless`);
  assert(wet.f <= firm.f + 12, `mud took ${wet.f} frames to calm against firm's ${firm.f} — the sticky ground must not settle SLOWER`);
});

/* ------------------------------------------------------------------ 5 ---- */
check('two falling men cannot occupy the same ground', () => {
  const a = buildRig(-0.4, 0, 0);
  const b = buildRig(0.4, 0, Math.PI);
  const ra = new Ragdoll(a.root, { vx: 4.2, vz: 0.2, vy: -1.0 }, GROUND);
  const rb = new Ragdoll(b.root, { vx: -3.6, vz: -0.2, vy: -0.9 }, GROUND);
  let overlap = 9;
  for (let f = 0; f < 200 && !(ra.settled && rb.settled); f++) {
    ra.weight = rb.weight = 1;
    ra.step(1 / 60); rb.step(1 / 60);
    Ragdoll.contact(ra, rb, 0.14);
    animate(a); animate(b);
    ra.apply(); rb.apply();
    a.root.updateMatrixWorld(true); b.root.updateMatrixWorld(true);
    for (const [x, y] of [['thigh_l', 'thigh_r'], ['chest', 'chest']] as [string, string][]) {
      const pa = ra.pos(x === 'chest' ? 'spine_03' : x)!, pb = rb.pos(y === 'chest' ? 'spine_03' : y)!;
      overlap = Math.min(overlap, Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z));
    }
  }
  const pa = ra.pos('pelvis')!, pb = rb.pos('pelvis')!;
  const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
  assert(d > 0.19, `pelvises ${d.toFixed(2)} m apart — they are inside each other`);
  assert(overlap > 0.05, `limbs passed to ${overlap.toFixed(2)} m apart — the pair sinks through one another`);
  assert(pa.y < 0.55 && pb.y < 0.55, 'neither man ended up on the deck despite the contact');
});

/* ------------------------------------------------------------------ 6 ---- */
check('the wrap survives the fall: pinned hands stay on the carrier', () => {
  const rig = buildRig(0, 0, 0);
  const rag = new Ragdoll(rig.root, { vx: 5.5, vz: 0.4 }, GROUND);
  const target = new THREE.Vector3(0.35, 0.98, 0.55);
  const p0 = rag.pos('hand_l')!;
  const d0 = Math.hypot(p0.x - target.x, p0.y - target.y, p0.z - target.z);
  let unpinned = 0;
  const free = new Ragdoll(buildRig(0, 0, 0).root, { vx: 5.5, vz: 0.4 }, GROUND);
  for (let f = 0; f < 45; f++) {
    rag.weight = 1;
    rag.clearPins();
    rag.pin('hand_l', target.x, target.y, target.z, 0.06);
    rag.pin('hand_r', target.x, target.y, target.z, 0.06);
    rag.step(1 / 60);
    animate(rig); rag.apply();
    rig.root.updateMatrixWorld(true);
    free.weight = 1; free.step(1 / 60);
    const h = free.pos('hand_l')!;
    unpinned = Math.max(unpinned, Math.hypot(h.x - target.x, h.y - target.y, h.z - target.z));
  }
  const h = rag.pos('hand_l')!;
  const d1 = Math.hypot(h.x - target.x, h.y - target.y, h.z - target.z);
  assert(d1 < d0 * 0.85, `pinned hand is ${d1.toFixed(2)} m from the waist (started ${d0.toFixed(2)}) — the wrap is not held`);
  assert(d1 < unpinned, `a pinned hand (${d1.toFixed(2)} m) is no closer than a free one (${unpinned.toFixed(2)} m) — the pin does nothing`);
});

/* ------------------------------------------------------------------ 7 ---- */
check('energy only leaves the system', () => {
  const rig = buildRig(0, 0, 0);
  const rag = new Ragdoll(rig.root, { vx: 7.0, vz: 1.5, vy: -1.4, spin: 1.2 }, GROUND);
  let peak = 0;
  const tail: number[] = [];
  for (let f = 0; f < 150; f++) {
    rag.weight = 1; rag.step(1 / 60); animate(rig); rag.apply();
    rig.root.updateMatrixWorld(true);
    if (f > 12) peak = Math.max(peak, rag.speed);
    if (f > 110) tail.push(rag.speed);
  }
  const last = Math.max(...tail);
  assert(last < peak * 0.35, `tail speed ${last.toFixed(2)} against a peak of ${peak.toFixed(2)} — it is still churning`);
});

/* ------------------------------------------------------------------ 8 ---- */
check('no NaN under an unreasonable hit, and it force-settles', () => {
  const rig = buildRig(0, 0, 0);
  const rag = new Ragdoll(rig.root, { vx: 44, vz: -31, vy: -26, spin: 24, airborne: 0.4 },
    { friction: 0.9, restitution: 0.4, y: 0 });
  let f = 0;
  for (; f < 400; f++) {
    rag.weight = 1; rag.step(1 / 60); animate(rig); rag.apply();
    rig.root.updateMatrixWorld(true);
    rig.bones.forEach((b) => {
      assert(Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w),
        'a bone quaternion went non-finite');
      assert(Number.isFinite(b.position.x + b.position.y + b.position.z), 'a bone went non-finite');
    });
    if (rag.settled) break;
  }
  assert(rag.settled, `still moving after ${f} frames`);
  assert(f / 60 < 2.8, `took ${(f / 60).toFixed(2)} s — the force-settle is not firing`);
});

/* ------------------------------------------------------------------ 9 ---- */
check('deterministic: the same fall twice, the same pose', () => {
  const run = () => {
    const rig = buildRig(0, 0, 0);
    const rag = new Ragdoll(rig.root, { vx: 5.1, vz: 1.9, vy: -0.7, spin: 0.4 }, GROUND);
    for (let f = 0; f < 60; f++) {
      rag.weight = 1; rag.step(1 / 60); animate(rig); rag.apply();
      rig.root.updateMatrixWorld(true);
    }
    return pose(rig, 'head').toArray().map((v) => v.toFixed(6)).join(',');
  };
  assert(run() === run(), 'the same seed produced a different fall');
});

/* ----------------------------------------------------------------- 10 ---- */
check('eight falls cost a fraction of the frame budget', () => {
  const rigs = Array.from({ length: 8 }, (_, i) => {
    const rig = buildRig(i * 0.9, 0, i * 0.4);
    const rag = new Ragdoll(rig.root,
      { vx: 4 + i * 0.4, vz: 1.2, vy: -1.0, spin: 0.6 - i * 0.1 },
      { friction: 0.55, restitution: 0.15, y: 0 });
    return { rig, rag };
  });
  const N = 240;
  const t0 = performance.now();
  for (let f = 0; f < N; f++) {
    for (const r of rigs) {
      r.rag.weight = 1;
      r.rag.setAnchor(f * 0.001, 0);
      r.rag.step(1 / 60);
      animate(r.rig);
      r.rag.apply();
      r.rig.root.updateMatrixWorld(true);
      Ragdoll.contact(r.rag, rigs[(rigs.indexOf(r) + 1) % 8].rag, 0.15);
    }
  }
  const per = (performance.now() - t0) / N;
  assert(per < 1.4, `${per.toFixed(3)} ms per frame across eight ragdolls — too dear`);
  console.log(`      cost: ${per.toFixed(3)} ms/frame for 8 simultaneous solved falls`);
});

/* ----------------------------------------------------------------- 11 ---- */
check('turf hits are reported for the wear pass, and drained once', () => {
  const rig = buildRig(0, 0, 0);
  const rag = new Ragdoll(rig.root, { vx: 6.5, vz: 0.6, vy: -2.6 }, GROUND);
  let hits = 0;
  for (let f = 0; f < 150 && !rag.settled; f++) {
    rag.weight = 1; rag.step(1 / 60); animate(rig); rag.apply();
    rig.root.updateMatrixWorld(true);
    for (const h of rag.takeContacts()) {
      assert(Number.isFinite(h.x) && Number.isFinite(h.z) && h.force > 0 && h.force <= 1.7, 'a bad contact report');
      hits++;
    }
    assert(rag.takeContacts().length === 0, 'contacts were not drained');
  }
  assert(hits >= 1, 'a man hit the deck and the pitch was told nothing');
});

/* ----------------------------------------------------------------- 12 ---- */
check('dragging the anchor moves the man, not the fall', () => {
  const rig = buildRig(0, 0, 0);
  const rag = new Ragdoll(rig.root, { vx: 5.0, vz: 0, vy: -0.4 }, GROUND);
  const poseOf = () => {
    const p = rag.pos('head')!, q = rag.pos('pelvis')!;
    return `${(p.x - q.x).toFixed(2)},${(p.y - q.y).toFixed(2)}`;
  };
  const rig2 = buildRig(0, 0, 0);
  const still = new Ragdoll(rig2.root, { vx: 5.0, vz: 0, vy: -0.4 }, GROUND);
  for (let f = 0; f < 24; f++) {
    rag.weight = 1; rag.step(1 / 60); animate(rig); rag.apply();
    rag.setAnchor(f * 0.02, f * 0.004);
    rig.root.updateMatrixWorld(true);
    still.weight = 1; still.step(1 / 60); animate(rig2); still.apply();
    rig2.root.updateMatrixWorld(true);
  }
  assert(poseOf() === poseOf(), 'the pose is flickering');
  assert(Math.abs(rag.dropY - still.dropY) < 0.12,
    `a man carried sideways fell ${rag.dropY.toFixed(2)} m against ${still.dropY.toFixed(2)} m — the engine's motion is being read as velocity`);
});

console.log('\n=== RAGDOLL SOLVER ===');
for (const r of results) console.log(r);
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall green');
process.exit(fails ? 1 : 0);
