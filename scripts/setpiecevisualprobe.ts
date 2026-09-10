/**
 * SET-PIECE VISUAL PROBE — THE SHAPE OF A SCRUM, A MAUL AND A LINEOUT.
 *
 * The engine has always known WHERE a set piece happens and WHO is in it. It
 * did not know what the three of them LOOKED like, so all three were placed as
 * the same thing: men on a lattice, upright, on one 'Push' clip — a huddle at a
 * scrum, a queue at a maul, a flat row at a lineout. The shapes are now
 * authored (behaviour/setpiece-overrides.ts, maulRegate.ts,
 * engine/setpieces.ts) and published per man for the rig to wear.
 *
 * This probe is the contract on those shapes. It asserts the GEOMETRY the
 * renderer consumes — not pixels, which a headless run cannot see, but every
 * number a body is placed and posed from:
 *
 *   (a) SCRUM    sixteen forwards in the 3-4-1 block, loosehead/hooker/tighthead
 *                on the tunnel, heads interlocked, shoulders driving, and every
 *                forward's torso pitched 30°–45° forward
 *   (b) MAUL     an upright condensed oval — every bound man inside the 15°
 *                ceiling, every slot inside a 2.0 m bound radius, the carrier
 *                at the head, the two walls in contact, the ball on the bodies
 *   (c) LINEOUT  two pods 3.5 m apart in the 5–15 m channel, a jumper between
 *                two lifters in each, the jumper's hands to the 2.8 m catch
 *                plane, his lifters' hands above their own hips under him
 *   (d) LIVE     a scrum and a maul actually placed through Director.placeBound
 *                publish those postures to the actors the rig renders, and a
 *                live lineout actually lifts a jumper off the ground
 *
 * Exit code 0 when every check passes.
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import {
  scrumBlock, HEAD_INTERLEAVE_M,
  SCRUM_FRONT_ROW_PITCH, SCRUM_SECOND_ROW_PITCH, SCRUM_BACK_ROW_PITCH,
} from '../src/game/behaviour/setpiece-overrides';
import {
  scrumVisualPlan, lineoutMarks, lineoutPods, lineoutMarkX,
  LINEOUT_POD_SPACING_M, LINEOUT_POD_FRONT_FROM_TOUCH_M, LINEOUT_TAIL_FROM_TOUCH_M,
  LINEOUT_JUMP_REACH_Y_M, LINEOUT_JUMP_BODY_LIFT_M, LINEOUT_LIFT_GRIP_Y_M,
  LINEOUT_LINE_GAP_M, LINEOUT_CATCH_PLANE_M,
} from '../src/game/engine/setpieces';
import {
  maulClusterSlots, maulBallMark, maulTailMark,
  MAUL_UPRIGHT_PITCH_MAX_RAD, MAUL_CARRIER_PITCH_RAD, MAUL_BIND_HEIGHT_M,
  MAUL_CLUSTER_WIDTH_M, MAUL_CLUSTER_DEPTH_M,
} from '../src/game/maulRegate';
import { LINEOUT_LINE_THROWING, LINEOUT_LINE_DEFENDING, lineoutRole } from '../src/game/engine/forwardPack';

let fails = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) { fails++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`);
};
const f2 = (v: number) => v.toFixed(2);
const D2R = 180 / Math.PI;

const NO_INPUT: any = { left: false, right: false, up: false, down: false, run: false, sprint: false };
const DT = 1 / 60;

/* ============================== (a) THE SCRUM ============================== */

console.log('SCRUM — the 3-4-1 block');
{
  const ax = 4, az = 40;
  const slots = scrumBlock(ax, az);
  check(slots.length === 16, `the block holds sixteen forwards (${slots.length})`);

  for (const team of ['A', 'B'] as const) {
    const pack = slots.filter((s) => s.team === team);
    const rows: Record<number, number> = {};
    for (const s of pack) rows[s.row] = (rows[s.row] ?? 0) + 1;
    check(rows[1] === 3 && rows[2] === 4 && rows[3] === 1,
      `${team} packs 3-4-1 (front ${rows[1]}, engine ${rows[2]}, base ${rows[3]})`);

    /* ---- THE ROW POSTURE: every forward inside the 30°–45° band ---- */
    const front = pack.filter((s) => s.row === 1);
    const engine = pack.filter((s) => s.row === 2);
    const base = pack.filter((s) => s.row === 3);
    const all = pack.map((s) => s.pitch * D2R);
    check(all.every((p) => p >= 30 - 1e-6 && p <= 45 + 1e-6),
      `${team} drives bent: every forward's pitch is inside 30°–45° (${all.map(f2).join('/')})`);
    check(front.every((s) => Math.abs(s.pitch - SCRUM_FRONT_ROW_PITCH) < 1e-9),
      `${team} front row pitches ${f2(SCRUM_FRONT_ROW_PITCH * D2R)}°`);
    check(engine.every((s) => Math.abs(s.pitch - SCRUM_SECOND_ROW_PITCH) < 1e-9),
      `${team} engine room pitches ${f2(SCRUM_SECOND_ROW_PITCH * D2R)}°`);
    check(base.every((s) => Math.abs(s.pitch - SCRUM_BACK_ROW_PITCH) < 1e-9),
      `${team} eight at the base pitches ${f2(SCRUM_BACK_ROW_PITCH * D2R)}°`);

    /* ---- THE FRONT ROW: loosehead LEFT, hooker MIDDLE, tighthead RIGHT ---- */
    const dirSign = team === 'A' ? 1 : -1;          // A faces +z, B faces −z
    const depth = (s: { z: number }) => (s.z - az) * dirSign;   // + = up-field of him
    const behind = (s: { z: number }) => (az - s.z) * dirSign;  // + = away from the tunnel
    const hk = front.find((s) => s.num === 2)!;
    const lh = front.find((s) => s.num === 1)!;
    const th = front.find((s) => s.num === 3)!;
    const ownLeft = (s: { x: number }) => (s.x - ax) * dirSign;
    check(behind(hk) === behind(lh) && behind(hk) === behind(th),
      `${team} front row is one line on the tunnel (${f2(behind(hk))} m back)`);
    check(Math.abs(hk.x - ax) < 0.25, `${team} hooker straddles the tunnel axis (${f2(hk.x - ax)} m off)`);
    check(ownLeft(lh) > ownLeft(hk) && ownLeft(hk) > ownLeft(th),
      `${team} loosehead left of the hooker, tighthead right of him (${[lh, hk, th].map((s) => f2(ownLeft(s))).join(' > ')})`);
    check(depth(lh) === depth(th) && depth(hk) === depth(lh),
      `${team} hooker's head is level with both props, not behind them`);

    /* ---- THE ENGINE ROOM BOUND BEHIND THE FRONT ROW ---- */
    const l4 = engine.find((s) => s.num === 4)!;
    const l5 = engine.find((s) => s.num === 5)!;
    check(behind(l4) > behind(hk) + 0.4 && behind(l4) < behind(hk) + 1.0,
      `${team} lock 4 binds directly behind the front row (${f2(behind(l4))} m back)`);
    const between = (v: number, a: number, b: number) => v > Math.min(a, b) && v < Math.max(a, b);
    check(between(l4.x, lh.x, hk.x),
      `${team} lock 4's head slots between the loosehead and the hooker`);
    check(between(l5.x, hk.x, th.x),
      `${team} lock 5's head slots between the hooker and the tighthead`);

    /* ---- THE EIGHT AT THE BASE ---- */
    const eight = base[0];
    check(eight.num === 8, `${team} base is the eight`);
    check(behind(eight) > behind(l4), `${team} eight is behind the engine room (${f2(behind(eight))} m back)`);
    check(Math.abs(eight.x - ax) < 0.05, `${team} eight is bound on the tunnel axis`);
  }

  /* ---- THE HEAD INTERLOCK: the two packs bind heads SIDE BY SIDE ---- */
  const aFront = slots.filter((s) => s.team === 'A' && s.row === 1);
  const bFront = slots.filter((s) => s.team === 'B' && s.row === 1);
  const heads = aFront.flatMap((p) => bFront.map((q) => ({
    d: Math.hypot(p.headX - q.headX, p.headZ - q.headZ),
    dx: Math.abs(p.headX - q.headX),
  })));
  const nearest = Math.min(...heads.map((h) => h.d));
  check(nearest > 0.15 && nearest < 0.6,
    `the nearest opposing heads interlock, never clash (${f2(nearest)} m apart)`);
  const sideBySide = heads.filter((h) => h.d < 0.6 && h.dx > 0.15).length;
  check(sideBySide >= 3,
    `heads bind beside each other, not nose to nose (${sideBySide} interlocked head pairs offset across the tunnel)`);
  for (const team of ['A', 'B'] as const) {
    const front = slots.filter((s) => s.team === team && s.row === 1);
    const offset = Math.abs(front.reduce((a, s) => a + s.x, 0) / 3 - ax);
    check(Math.abs(offset - HEAD_INTERLEAVE_M) < 0.02,
      `${team} front row is shifted the half head that makes the interlock (${f2(offset)} m)`);
  }

  /* ---- SHOULDERS DRIVING AGAINST SHOULDERS ---- */
  let minApproach = Infinity;
  for (const p of aFront) for (const q of bFront) {
    minApproach = Math.min(minApproach, Math.hypot(p.x - q.x, p.z - q.z));
  }
  check(minApproach > 0.3 && minApproach < 1.2,
    `the two front rows are in binding contact (closest shoulders ${f2(minApproach)} m apart)`);
  const forwardOf = (s: { z: number; bindZ: number }) =>
    (s.bindZ - s.z) * (s.z > az ? -1 : 1);   // + = toward the tunnel, off his own feet
  check(aFront.every((s) => forwardOf(s) > 0.2) && bFront.every((s) => forwardOf(s) > 0.2),
    'every front-rower binds FORWARD of his own feet, onto the man opposite');
  check(aFront.every((s) => s.bindY > 0.6 && s.bindY < 1.6),
    `hands work at shoulder height (${f2(aFront[0].bindY)} m)`);

  /* ---- THE RENDER CONTRACT: the same block, keyed per man ---- */
  const plan = scrumVisualPlan(ax, az);
  check(plan.size === 16 && plan.has('A:1') && plan.has('B:8'),
    'the visual plan publishes all sixteen slots (A:1 … B:8)');
  const p1 = plan.get('A:1')!;
  check(Math.abs(p1.pitch - SCRUM_FRONT_ROW_PITCH) < 1e-9 && p1.facing === 0 && plan.get('B:1')!.facing === Math.PI,
    'the plan carries each man\u2019s pitch and his locked engagement heading');
  const mismatched = slots.filter((s) => {
    const q = plan.get(`${s.team}:${s.num}`)!;
    return Math.abs(q.x - s.x) > 1e-9 || Math.abs(q.z - s.z) > 1e-9;
  }).length;
  check(mismatched === 0, 'the plan and the block place the same sixteen men on the same marks');
}

/* =============================== (b) THE MAUL ============================== */

console.log('MAUL — the upright condensed oval');
{
  const slots = maulClusterSlots('A', 1, 0, 0, 0, 8);
  const atk = slots.filter((s) => s.team === 'A');
  const def = slots.filter((s) => s.team === 'B');
  check(slots.length === 16 && atk.length === 8 && def.length === 8,
    `both packs bind into the cluster (${atk.length} + ${def.length})`);

  const pitches = slots.map((s) => s.pitch * D2R);
  check(pitches.every((p) => p < MAUL_UPRIGHT_PITCH_MAX_RAD * D2R + 1e-6),
    `every bound man is upright — pitch under ${f2(MAUL_UPRIGHT_PITCH_MAX_RAD * D2R)}° (worst ${f2(Math.max(...pitches))}°)`);
  const carrier = atk.find((s) => s.role === 'CARRIER')!;
  check(carrier.num === 1 && carrier.pitch <= (10 * Math.PI) / 180,
    `the ball carrier stands up at 4° (${f2(carrier.pitch * D2R)}°)`);

  /* NO SINGLE-FILE: a bound radius, and a body beside every body. */
  const radii = slots.map((s) => Math.hypot(s.x, s.z));
  check(Math.max(...radii) < 2.0,
    `every bound man is inside the 2.0 m bound radius (furthest ${f2(Math.max(...radii))} m)`);
  let lonely = 0;
  for (const s of slots) {
    const mates = slots.filter((q) => q.team === s.team && q.num !== s.num);
    if (Math.min(...mates.map((q) => Math.hypot(q.x - s.x, q.z - s.z))) > 1.6) lonely++;
  }
  check(lonely === 0, `no man is strung out alone — every man has a team-mate inside 1.6 m (${lonely} alone)`);

  const zs = slots.map((s) => s.z), xs = slots.map((s) => s.x);
  check((Math.max(...zs) - Math.min(...zs)) <= MAUL_CLUSTER_DEPTH_M
    && (Math.max(...xs) - Math.min(...xs)) <= MAUL_CLUSTER_WIDTH_M,
    `the shape is a condensed oval, not a line: ${f2(Math.max(...zs) - Math.min(...zs))} m deep × ${f2(Math.max(...xs) - Math.min(...xs))} m wide`);

  /* the carrier leads, the tail trails, and the two walls are in contact */
  const attackN = atk.map((s) => s.n);
  check(carrier.n === Math.max(...attackN),
    `the carrier is the head of the drive (n=${f2(carrier.n)} vs the pack's ${f2(Math.max(...attackN))})`);
  let closest = Infinity;
  for (const p of atk) for (const q of def) closest = Math.min(closest, Math.hypot(p.x - q.x, p.z - q.z));
  check(closest < 0.9, `the defending wall is pushing on the attacking wall (${f2(closest)} m apart)`);
  check(slots.every((s) => s.handY === MAUL_BIND_HEIGHT_M && Math.hypot(s.handX - s.x, s.handZ - s.z) > 0.4),
    `hands wrap forward at chest height (${MAUL_BIND_HEIGHT_M} m)`);

  /* the ball rides the ranked bodies, and the tail mark IS the deepest rank */
  const b1 = maulBallMark(1, 0, 0, 0, 1);
  const b8 = maulBallMark(1, 0, 0, 0, 8);
  const tail = maulTailMark(1, 8, 0, 0);
  const rank8 = atk.find((s) => s.num === 8)!;
  check(Math.abs(b1.y - 1.02) < 1e-9 && Math.hypot(b1.x - carrier.x, b1.z - carrier.z) < 0.05,
    'the ball starts in the carrier\u2019s hands at rank 1');
  check(Math.hypot(b8.x - rank8.x, b8.z - rank8.z) < 1e-9,
    'the ball channels onto the tail man\u2019s hands at rank 8');
  check(Math.abs(tail.z - rank8.z) < 1e-9 && Math.abs(tail.x) < 1e-9,
    'the tail mark is the hindmost attack slot, not a made-up cadence');

  /* mirrored through the mark for a side attacking the other way */
  /* A man's own left changes side when the drive turns round, so the mirrored
   * oval flips BOTH axes through the mark: same shape, same binding, the other
   * way down the pitch. */
  const back = maulClusterSlots('A', -1, 0, 0, 0, 8).filter((s) => s.team === 'A');
  const mirrored = back.every((s) => atk.some((q) => q.num === s.num && Math.abs(q.x + s.x) < 1e-9 && Math.abs(q.z + s.z) < 1e-9));
  check(mirrored, 'the same oval binds for a side attacking -z (mirrored through the mark)');

  /* the wheel: the cluster turns, it does not smear */
  const wheel = maulClusterSlots('A', 1, 0, 0, 20, 8);
  const wheelRadius = Math.hypot(wheel[6].x, wheel[6].z);
  check(wheelRadius <= Math.hypot(rank8.x, rank8.z) + 1e-6,
    'at a 20° wheel the slots stay inside the same oval');
}

/* ============================= (c) THE LINEOUT ============================= */

console.log('LINEOUT — two pods and a tail');
{
  const line = [...LINEOUT_LINE_THROWING];
  const marks = lineoutMarks(line);
  check(marks.length === line.length, `every man of the line has a mark (${marks.length}/7)`);
  const pods = lineoutPods(line);
  check(pods.length === 2, `the line forms two pods (${pods.length})`);
  check(pods[0].key === 'FRONT' && pods[1].key === 'BACK', 'the pods are front and back');
  check(Math.abs((pods[1].centerM - pods[0].centerM) - LINEOUT_POD_SPACING_M) < 1e-9,
    `the pod centres are ${f2(LINEOUT_POD_SPACING_M)} m apart (${f2(pods[0].centerM)} / ${f2(pods[1].centerM)} m from touch)`);
  check(pods[0].men.join() === '1,4,6' && pods[1].men.join() === '3,5,7',
    `the pods are prop·lock·flanker (front ${pods[0].men.join('-')}, back ${pods[1].men.join('-')})`);
  for (const pod of pods) {
    const roles = pod.men.map((n) => lineoutRole(n));
    check(roles.filter((r) => r === 'JUMPER').length === 1 && roles.filter((r) => r === 'LIFTER').length === 2,
      `${pod.key} pod = one jumper lifted by two lifters (${pod.men.map((n, i) => `${n}${roles[i] === 'JUMPER' ? 'J' : 'L'}`).join(' ')})`);
    check(pod.lifters.length === 2 && pod.lifters.every((n) => n !== pod.jumper),
      `${pod.key} pod's lift pair is both of the men beside the jumper`);
  }

  /* THE CHANNEL: the law opens the channel at 5 m; every mark is inside it. */
  check(marks.every((m) => m.fromTouchM >= 5.0 - 1e-9 && m.fromTouchM <= 15.0 + 1e-9),
    `every mark is inside the 5–15 m channel (${marks.map((m) => f2(m.fromTouchM)).join('/')})`);
  check(Math.min(...marks.map((m) => m.fromTouchM)) === 5.0,
    'the front pod\u2019s front lifter stands exactly ON the 5-metre line');
  const tail = marks.find((m) => m.num === 8)!;
  check(Math.abs(tail.fromTouchM - LINEOUT_TAIL_FROM_TOUCH_M) < 1e-9 && tail.pod === 'TAIL',
    `the eight is the tail, ${f2(tail.fromTouchM)} m from touch`);
  const jumperMarks = marks.filter((m) => m.role === 'JUMPER').map((m) => m.fromTouchM).sort((a, b) => a - b);
  check(Math.abs(jumperMarks[0] - pods[0].centerM) < 1e-9 && Math.abs(jumperMarks[1] - pods[1].centerM) < 1e-9,
    'each pod\u2019s jumper is on his pod\u2019s centre — the call lands on the jumper');
  /* inside a pod the men are shoulder to shoulder; between the pods there is
   * the open channel that makes them two pods and not one grey line */
  const inPod = pods.flatMap((pod) => {
    const m = pod.fromTouchM.slice().sort((a, b) => a - b);
    return m.slice(1).map((v, i) => v - m[i]);
  });
  check(Math.max(...inPod) <= 0.71,
    `the pods close up: no gap inside a pod over 0.71 m (${inPod.map(f2).join('/')})`);
  const podGap = pods[1].fromTouchM.slice().sort((a, b) => a - b)[0]
    - pods[0].fromTouchM.slice().sort((a, b) => a - b).slice(-1)[0];
  check(podGap > 1.5,
    `the two pods are separated by ${f2(podGap)} m of open channel, not joined into one line`);

  /* the defending line is the same structure minus the roving seven */
  const dMarks = lineoutMarks([...LINEOUT_LINE_DEFENDING]);
  const dPods = lineoutPods([...LINEOUT_LINE_DEFENDING]);
  check(dMarks.length === 6 && dPods.length === 2 && dPods[0].men.join() === '1,4,6',
    `the defending line forms the same two pods (${dPods.map((p) => p.men.join('-')).join(' / ')})`);
  check(dMarks.every((m) => m.fromTouchM >= 5.0 && m.fromTouchM <= 15.0),
    'the defending line stands in the same channel');
  check(dPods[1].jumper === 5 && lineoutRole(8) === 'JUMPER',
    'the defending five is the back-pod jumper and the eight takes the tail');

  /* THE LIFT'S NUMBERS */
  check(LINEOUT_JUMP_REACH_Y_M >= 2.5,
    `the lifted jumper\u2019s hands reach ${f2(LINEOUT_JUMP_REACH_Y_M)} m — the probe\u2019s 2.5 m floor`);
  check(LINEOUT_JUMP_BODY_LIFT_M > 0.3 && LINEOUT_JUMP_BODY_LIFT_M < 1.2,
    `his feet leave the turf by ${f2(LINEOUT_JUMP_BODY_LIFT_M)} m — a lift, not a launch`);
  check(LINEOUT_LIFT_GRIP_Y_M > 1.0,
    `his lifters\u2019 hands work at ${f2(LINEOUT_LIFT_GRIP_Y_M)} m: above their own hips, under the man`);
  check(Math.abs(LINEOUT_CATCH_PLANE_M - LINEOUT_JUMP_REACH_Y_M) < 1e-9,
    'the ball is caught ON the plane the lift buys, not on a made-up apex');
  check(LINEOUT_LINE_GAP_M > 0.5 && LINEOUT_LINE_GAP_M < 1.2,
    `the two lines face each other across ${f2(LINEOUT_LINE_GAP_M * 2)} m of tunnel`);
}

/* ==================== (d) THE LIVE SHAPES REACH THE ACTORS ==================== */

console.log('LIVE — a scrum drives low');
{
  seedRng(7100);
  const d: any = new Director(gateConfig(6));
  d.releaseAll();
  d.startScrum('A', 6, 30);
  let seen = 0, worst = -1, bindless = 0, nans = 0;
  for (let i = 0; i < 60 * 20; i++) {
    d.update(DT, NO_INPUT, new Set());
    for (const a of d.actors) {
      if (a.team === 'REF') continue;
      if (!Number.isFinite(a.pitch)) nans++;
      const deg = (a.pitch ?? 0) * D2R;
      if (deg > 0.01) {
        seen++;
        if (deg > worst) worst = deg;
        if (deg < 30 - 1e-6 || deg > 45 + 1e-6) worst = Math.max(worst, 999);
        if (a.bindX === undefined) bindless++;
      }
    }
    if (d.scrim && d.scrim.stage === 'DRIVE') break;
  }
  check(nans === 0, 'no NaN postures reached an actor');
  check(seen > 16 * 30, `the pack's posture is published every frame (${seen} man-frames)`);
  check(worst > 30 && worst <= 45,
    `every published pack pitch is inside 30°–45° (worst ${f2(worst)}°)`);
  check(bindless === 0, 'every bent forward also publishes a bind point for his hands');
}

console.log('LIVE — a maul stays on its feet');
{
  seedRng(7200);
  const d: any = new Director(gateConfig(6));
  d.releaseAll();
  d.startMaul('A', 0, 0, 8, false);
  let worst = -1, far = 0, binned = 0, formed = 0, boundFrames = 0;
  for (let i = 0; i < 60 * 4; i++) {
    d.update(DT, NO_INPUT, new Set());
    const m: any = d.ml;
    if (!m) continue;
    /* THE CLUSTER'S OWN SLOTS. Read the shape the engine placed from — the
     * same call placeBound used — so the audit is of the sixteen BOUND men and
     * not of the nine or the referee, who stand nearby and are not of them. */
    const slots = maulClusterSlots(m.attacking, m.dir, m.x, m.z, m.yaw, m.ranks);
    const live = slots.filter((s) => d.L(s.team, s.num).sinbin <= 0);
    let here = 0;
    for (const slot of live) {
      const a = d.actors.find((q: any) => q.team === slot.team && q.num === slot.num);
      if (!a) continue;
      here++;
      const p = (a.pitch ?? 0) * D2R;
      if (p > worst) worst = p;
      if (p > MAUL_UPRIGHT_PITCH_MAX_RAD * D2R + 1e-6) far++;
      if (a.bindX === undefined || Math.abs((a.bindY ?? 0) - MAUL_BIND_HEIGHT_M) > 1e-6) binned++;
    }
    boundFrames++;
    if (here >= 16) formed++;
  }
  check(boundFrames > 60, `a formed maul ran ${boundFrames} audited frames`);
  check(formed > 30, `the sixteen bound men were all placed on the same mark (${formed} fully-formed frames)`);
  check(worst >= 0 && worst <= MAUL_UPRIGHT_PITCH_MAX_RAD * D2R + 1e-6,
    `every bound man stayed upright (worst ${f2(worst)}° ≤ ${f2(MAUL_UPRIGHT_PITCH_MAX_RAD * D2R)}°)`);
  check(far === 0, 'nobody in a formed maul was bent past the ceiling');
  check(binned === 0, `every bound man's hands wrap forward at ${MAUL_BIND_HEIGHT_M} m (${binned} exceptions)`);
}

console.log('LIVE — a lineout lifts its jumper');
{
  seedRng(7300);
  const d: any = new Director(gateConfig(6));
  d.releaseAll();
  d.startLineout('A', 30, 30);
  let s = d.lo!;
  s.callIdx = 1;              // MIDDLE + DRIVE, thrown to the BACK pod
  s.driveCall = true;
  /* WALK THE LINE IN FIRST. A lift cannot reach a man who is not in his pod,
   * and the engine deliberately refuses to teleport him into one (the ASSEMBLE
   * stage advances when the line is 82% arrived, or at 2.2 s). Throwing on the
   * assembly frame measured the state's ramps while the bodies were still
   * jogging in: the lineout's own numbers rose and the rig never saw them,
   * which is exactly the defect this probe exists to catch. */
  /* The phase machine forces CALL at 2.2 s and the CPU throws ~0.3 s later,
   * which in a match is enough (the whistle is blown where the line is). Here
   * the throwing pack starts 70 m away, so the probe HOLDS the throw until the
   * line has actually walked in: a lineout thrown over a pack still jogging up
   * the touchline is not a shape to measure. */
  const realRelease = d.releaseThrow.bind(d);
  let holdThrow = true;
  d.releaseThrow = () => { if (!holdThrow) realRelease(); };
  let warmed = 0, assembled = false;
  for (let i = 0; i < 60 * 25 && d.lo; i++) {
    warmed++;
    d.update(DT, NO_INPUT, new Set());
    const lo: any = d.lo;
    if (!lo) break;
    const here = lo.players.filter((q: any) => {
      const p = d.L(q.team, q.num);
      return Math.hypot(p.x - q.x, p.z - q.z) < 1.3;
    }).length;
    if (lo.stage === 'THROW' && here === lo.players.length) { assembled = true; break; }
  }
  const loNow: any = d.lo!;
  const c = Director.LO_CALLS[1];
  const thr = loNow.players.find((q: any) => q.role === 'THROWER')!;
  const side = thr.x >= 0 ? 1 : -1;
  loNow.call = {
    targetX: lineoutMarkX(side, c.fromTouchM), label: c.label,
    jumpers: c.jumpers, kind: c.kind,
  };
  loNow.driveCall = true;
  loNow.meter = 0.62;
  holdThrow = false;
  realRelease();
  /* Keep the STATE OBJECT, not `d.lo`: the catch hands the ball over and then
   * clears the field in the same frame, so the only witness to who caught it
   * is the object itself, mutated in place. */
  const loRef: any = s;
  let maxLift = 0, maxReach = 0, maxLifterHand = 0, lifterGrip = 0;
  let aerial = 0, ballAt = 0, nans = 0, flew = false, awardY = -1, awardId = -1;
  let actorLift = 0, actorReach = 0, actorBound = 0;  // what the RIG receives
  for (let i = 0; i < 60 * 3; i++) {
    d.update(DT, NO_INPUT, new Set());
    const lo: any = d.lo;
    /* the catch lands and the field is cleared in the SAME update, so the
     * award is read off the retained state object, not off `d.lo`. */
    if (loRef.ball.state === 'FLIGHT') flew = true;
    if (flew && loRef.ball.state === 'HELD' && awardId < 0) {
      awardId = loRef.ball.heldBy;
      awardY = loRef.ball.y;
    }
    if (lo) {
      /* AND WHAT THE RIG ACTUALLY GETS: the same lift, published onto the
       * actors the renderer reads — a lift in the state that never reaches a
       * body is a lift nobody sees. */
      for (const a of d.actors) {
        if (a.team === 'REF') continue;
        actorLift = Math.max(actorLift, a.liftY ?? 0);
        actorReach = Math.max(actorReach, a.reachY ?? 0);
        if (a.liftY !== undefined && a.bindX !== undefined) actorBound++;
      }
      for (const q of lo.players) {
        if (!Number.isFinite(q.liftY ?? 0) || !Number.isFinite(q.handY ?? 0)) nans++;
        if (q.role === 'JUMPER') {
          maxLift = Math.max(maxLift, q.liftY ?? 0);
          maxReach = Math.max(maxReach, q.handY ?? 0);
          if ((q.liftY ?? 0) > 0.1) aerial++;
          if (Math.abs(lo.ball.x - q.x) < 1.6) ballAt++;
        } else if (q.role === 'LIFTER') {
          maxLifterHand = Math.max(maxLifterHand, q.handY ?? 0);
          if (q.bindY !== undefined && q.bindY > 1.0) lifterGrip++;
        }
      }
    }
  }
  check(nans === 0, 'no NaN lift state');
  check(maxLift > 0.3 && maxLift <= LINEOUT_JUMP_BODY_LIFT_M + 1e-6,
    `the jumper left the ground (${f2(maxLift)} m of foot clearance)`);
  check(maxReach > 2.5, `his hands reached the catch plane (${f2(maxReach)} m ≥ 2.5 m)`);
  check(aerial > 10, `the lift lasted, it did not blink (${aerial} lifted man-frames)`);
  check(ballAt > 0, 'the lift happened at the ball — the jumper was at the throw’s mark');
  check(maxLifterHand > 1.0, `his lifters’ hands came up under him (${f2(maxLifterHand)} m)`);
  check(actorLift > 0.3, `the lift reached the rig (actor liftY peaked at ${f2(actorLift)} m)`);
  check(actorReach > 2.5, `the catch plane reached the rig (actor reachY ${f2(actorReach)} m)`);
  check(actorBound > 0, `the bind anchors reached the rig (${actorBound} lifted man-frames carried both a lift and a hand target)`);
  check(lifterGrip > 0, 'a lifter’s hands were anchored on the jumper’s thighs');

  /* THE CATCH IS THE POD'S, NOT THE ROSTER'S. A ball thrown to the back pod
   * must be caught by the back pod's jumper at the ball's own mark; the old
   * award read the first jumper in roster order (always the front pod's lock)
   * and handed him a ball three and a half metres away. */
  check(assembled && warmed > 30,
    `the line walked in and stood in its pods before the throw (${warmed} frames)`);
  check(flew, 'the ball flew on its authored parabola');
  if (flew && awardId >= 0) {
    const js = loRef.players.filter((q: any) => q.role === 'JUMPER');
    const near = js.slice().sort((a: any, b: any) =>
      Math.hypot(a.x - loRef.ball.x, a.z - loRef.ball.z) - Math.hypot(b.x - loRef.ball.x, b.z - loRef.ball.z))[0];
    check(awardId === near.id,
      `the ball went to the jumper AT the ball, not the first one in the roster (id ${awardId} = jumper ${near.num})`);
    check(awardId !== js[0].id || js.length === 1,
      'the front pod\u2019s jumper did not collect a back-pod throw by roster order');
  }
  check(awardY >= 0 && Math.abs(awardY - LINEOUT_CATCH_PLANE_M) < 0.35,
    `the catch was made on the authored plane (${f2(awardY)} m ≈ ${f2(LINEOUT_CATCH_PLANE_M)} m)`);
}

console.log(`\nSET-PIECE VISUAL PROBE ${fails === 0 ? 'PASSES' : `FAILS (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
