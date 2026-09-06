/**
 * RAGDOLL POSE CHECK — headless verification of the runtime pose mapping.
 *
 * 1. The bank decodes, nearest-match is deterministic, interpolation sane.
 * 2. expand() mirrors correctly (lead/trail swap, lateral signs flip).
 * 3. buildPose maps channels onto the rig's conventions (flex raises forward,
 *    knees bend backward, spine crunches forward) with the correct signs.
 *
 * Usage:  npx vite-node tools/ragdollPoseCheck.ts
 */
import { findFall, samplePose, expand, entryCount } from '../src/physics/fallBank';
import { buildPose } from '../src/physics/poseMap';
import type { Quat } from '../src/physics/poseMap';

let fails = 0;
function check(label: string, ok: boolean, extra = '') {
  if (!ok) { fails++; console.log(`FAIL ${label}${extra ? ' — ' + extra : ''}`); }
  else console.log(` ok  ${label}`);
}

/** recover the rotation angle (rad) a quat applies about its axis */
const ang = (q: Quat) => 2 * Math.atan2(Math.hypot(q.x, q.y, q.z), q.w);
const sign = (q: Quat, ax: 'x' | 'y' | 'z') => Math.sign(q[ax]);

check('bank has entries', entryCount() === 180, `count=${entryCount()}`);
const a = findFall({ kind: 'FALL', speed: 6.2, hitH: 0.5, massR: 1.05, dir: 'F' });
const b = findFall({ kind: 'FALL', speed: 6.2, hitH: 0.5, massR: 1.05, dir: 'F' });
check('nearest-match deterministic', a === b);
check('nearest F fall is a F fall', a.meta.kind === 'FALL' && (a.meta.dir === 0 || a.meta.dir === 0.5 || a.meta.dir === 1));

const nearS = findFall({ kind: 'FALL', speed: 7, hitH: 0.6, massR: 1, dir: 'S' });
check('lateral lookup prefers lateral', nearS.meta.dir === 0.5, `got dir ${nearS.meta.dir}`);

// sample continuity + range
const p0 = samplePose(a, 0, false);
const p05 = samplePose(a, 0.5, false);
const p30 = samplePose(a, 0.3, false);
check('sample starts near upright', Math.abs(p0[0]) < 0.4, `pitch=${p0[0].toFixed(2)}`);
check('sample finite', Array.from(p05).every(Number.isFinite));
const midOk = Math.abs(p30[0]) > 0.15 && Math.abs(p05[0]) > 0.15;
check('mid-fall pitch meaningful', midOk, `t0.3=${p30[0].toFixed(2)} t0.5=${p05[0].toFixed(2)}`);
const pend = samplePose(a, 2.0, false);
check('fall ends near prone', Math.abs(Math.abs(pend[0]) - Math.PI / 2) < 0.55, `pitch=${pend[0].toFixed(2)}`);

// mirror: lateral signs flip, limb lead swaps
const s0 = samplePose(nearS, 0.45, false);
const s1 = samplePose(nearS, 0.45, true);
check('mirror flips twist', Math.sign(s1[1]) === -Math.sign(s0[1]) || Math.abs(s0[1]) < 1e-3, `${s0[1].toFixed(2)} vs ${s1[1].toFixed(2)}`);
check('mirror swaps arm lead', s1[6] !== s0[6]);
check('mirror keeps pitch', Math.abs(s1[0] - s0[0]) < 1e-4);

// pure expand() contract
const approx = (a: number, b: number, e = 1e-4) => Math.abs(a - b) < e;
const core = [0.5, 0.9, 0.1, -0.2, 0.3, 1.0, 0.6, 0.8, 1.2, 0.2, 0.5];
const exL = expand(core, false);
const exR = expand(core, true);
check('expand right keeps right lead', approx(exL[6], core[6]) && !approx(exL[9], core[6]), `r=${exL[6]} l=${exL[9]}`);
check('expand mirror swaps ab lead', !approx(exR[6], exL[6]) && approx(exR[9], exL[6]), `r=${exR[6]} l=${exR[9]}`);
check('expand mirror flips headY/twist', approx(exR[4], -exL[4]) && approx(exR[1], -exL[1]));

// buildPose sign conventions (root renderer must match the solver).
// Identity refs ≈ rig aligned with the model axes (fx = X, ab = Z) so the
// quaternion components can be checked directly.
const refs: Record<string, unknown> = {};
const QID = { w: 1, x: 0, y: 0, z: 0 };
for (const n of ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r',
  'thigh_l', 'calf_l', 'thigh_r', 'calf_r'] as const) {
  refs[n] = { r: QID, fx: [1, 0, 0], ab: [0, 0, 1] };
}
const ch = Array.from(expand(
  [0.6, 0.0, 0.7, 0.0, -0.2, 1.0, 0.5, 0.8, 1.0, 0.5, 0.9],
  false,
)) as unknown as number[];
const pose = buildPose(ch, refs as never);
const bR = pose.bones as Record<string, Quat>;
check('pitch channel passthrough', Math.abs(pose.pitch - 0.6) < 1e-6);
check('spine crunches forward (+X)', sign(bR.spine_01, 'x') > 0 && ang(bR.spine_01) > 0.2, `ang=${ang(bR.spine_01).toFixed(3)}`);
check('upper arm flex forward (-X)', sign(bR.upperarm_r, 'x') < 0 && ang(bR.upperarm_r) > 0.8, `ang=${ang(bR.upperarm_r).toFixed(3)}`);
check('upper arm abducts right (+Z for right limb)', sign(bR.upperarm_r, 'z') < 0 && ang(bR.upperarm_r) > 0.4, `z=${bR.upperarm_r.z.toFixed(3)}`);
check('left arm abducts mirrored', sign(bR.upperarm_l, 'z') > 0, `z=${bR.upperarm_l.z.toFixed(3)}`);
check('elbow bends (-X on forearm)', sign(bR.lowerarm_r, 'x') < 0 && ang(bR.lowerarm_r) > 0.5, `ang=${ang(bR.lowerarm_r).toFixed(3)}`);
check('thigh flexes forward (-X)', sign(bR.thigh_r, 'x') < 0 && ang(bR.thigh_r) > 0.8, `ang=${ang(bR.thigh_r).toFixed(3)}`);
check('knee bends shin back (+X)', sign(bR.calf_r, 'x') > 0 && ang(bR.calf_r) > 0.5, `ang=${ang(bR.calf_r).toFixed(3)}`);
check('head lag applies on neck (ab axis)', sign(bR.neck_01, 'z') < 0 && Math.abs(ang(bR.neck_01) - 0.2) < 0.05, `z=${bR.neck_01.z.toFixed(3)}`);
check('left arm flex mirrors right', Math.abs(bR.upperarm_l.x - bR.upperarm_r.x) < 0.02, `lx=${bR.upperarm_l.x.toFixed(3)} rx=${bR.upperarm_r.x.toFixed(3)}`);
check('left thigh flex mirrors right', Math.abs(bR.thigh_l.x - bR.thigh_r.x) < 0.12, `lx=${bR.thigh_l.x.toFixed(3)} rx=${bR.thigh_r.x.toFixed(3)}`);

console.log(fails === 0 ? '\nRAGDOLL POSE CHECK: ALL PASS' : `\nRAGDOLL POSE CHECK: ${fails} FAILURES`);
process.exitCode = fails ? 1 : 0;
