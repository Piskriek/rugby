/**
 * BIND PROBE — do the sixteen hands actually get to the anatomy?
 *
 *   npx tsx scripts/bindprobe.ts
 *
 * This is the file the scrum bind work is measured with, and it is deliberately
 * not a test of the authored table. `behaviour/setpiece-overrides.ts` says what
 * a loosehead's left hand is supposed to be doing; that is a wish, and a wish
 * can be authored to fit any test. What is checked here is the SHIPPED RIG:
 * `public/assets/models/rugby_player.glb` is loaded through the headless Skia
 * harness (`_nodeCanvas`), the manager poses the pack for real, and the bone
 * transforms that come out the other side are what the assertions read. If the
 * IK cannot reach an anchor, if a bone name is wrong, if the pelvis write is
 * fighting the mixer, this fails and says which shirt and which hand.
 *
 * Five claims, in the order the pack lives:
 *
 *   (a) BIND   every hand lands within 0.08 m of its socket, and the hand is at
 *              the body part the anatomy names — a grip 0.5 m from the ribs is
 *              a grip on nobody.
 *   (b) TUNNEL the head bone faces down the engagement axis (±5°) for both
 *              packs, and the packs face EACH OTHER.
 *   (c) HEIGHT every bound forward's pelvis sits within 0.03 m of the hip
 *              height the engine published for him, with his feet still where
 *              the turf put them.
 *   (d) COLLAPSE a front row that loses its bind comes down, `collapseSeen`
 *              asserts true, the fold reaches the deck, and the whistle tears
 *              the phase down cleanly.
 *   (e) RELEASE 2.4 s after that whistle, NOTHING of the pose survives: no
 *              published hip height, no grip still aimed at a body the man has
 *              left, no planted ankle trailing him as he runs off, and no frame
 *              where the pelvis jumps — the pose is a debt to the animation and
 *              it has to be paid back, not written off.
 *
 * Two things the harness does on purpose, both stated where they are used: the
 * pack is SEATED on its slots every frame (a scrum formed in the open field has
 * sixteen men still jogging from wherever the last phase left them, and the
 * bind layer correctly refuses to pose a man who is not in the pack yet — a
 * probe that waited for the arrival would be testing the AI's legs), and the
 * collapse is FORCED by moving a bound prop off his seat (a natural collapse is
 * a rare, seeded event; a probe that waited for one would be flaky by design).
 *
 * Exits 0 on pass.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { installNodeCanvas } from './_nodeCanvas';
installNodeCanvas();

const MODEL = path.resolve(process.cwd(), 'public/assets/models/rugby_player.glb');
const PAIR = path.resolve(process.cwd(), 'public/assets/models/tackle_pair.glb');

/* ============================= assertions ============================= */

let failures = 0;
const lines: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); lines.push(`  ok    ${name}`); } catch (e) {
    failures++;
    lines.push(`  FAIL  ${name}\n        ${String((e as Error).message || e)}`);
  }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const fmt = (v: number, d = 3) => v.toFixed(d);

/* ============================== the sim ============================== */

const DT = 1 / 50;

async function main() {
  if (!fs.existsSync(MODEL)) {
    console.log('SKIP  no rig in this checkout — nothing to measure');
    console.log('      (the bind layer needs the shipped skeleton, not a stand-in)');
    process.exit(0);
  }
  const files: Record<string, string> = { 'rugby_player.glb': MODEL, 'tackle_pair.glb': PAIR };
  (globalThis as any).fetch = async (url: string) => {
    const rel = files[String(url).split('/').pop() ?? ''];
    if (!rel) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const buf = fs.readFileSync(path.resolve(rel));
    return {
      ok: true, status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };

  const THREE = await import('three');
  const { Director, NO_INPUT } = await import('../src/game/director');
  const { gateConfig } = await import('../src/game/gates');
  const { seedRng } = await import('../src/game/seed');
  const { RENDER_SCALE } = await import('../src/render/retro');
  const { ThreeEnvironment } = await import('../src/render/ThreeEnvironment');
  const { ThreePlayerManager } = await import('../src/render/ThreePlayerManager');
  const { MAUL_RANKS_PER_SIDE } = await import('../src/game/maulRegate');
  const {
    PACK_BIND_SOCKETS, SCRUM_COLLAPSE, STANDING_PELVIS_Y, scrumHipY, scrumFacing,
    scrumBindSockets,
  } = await import('../src/game/behaviour/setpiece-overrides');

  const S = RENDER_SCALE;

  /* ---- a scrum, held on its slots until the pack is bound and driving ---- */
  seedRng(1);
  const d: any = new Director(gateConfig(6));
  const calls: string[] = [];
  const origLawCall = d.lawCall.bind(d);
  d.lawCall = (kind: string, text: string, team: string) => { calls.push(kind); return origLawCall(kind, text, team); };

  d.startScrum('A', 0, 0);
  const s = d.scrim;
  assert(!!s, 'startScrum() did not create a scrum');
  const ax = d.scrumAnchor;

  /** put the pack on its seats, exactly the way placeBound computes them */
  const seat = () => {
    const yaw = (s.yaw * Math.PI) / 180;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    for (const slot of s.players) {
      const p = d.L(slot.team, slot.num);
      const dx = slot.x - ax.x, dz = slot.z - ax.z + s.netDrive;
      const wx = ax.x + dx * cosY - dz * sinY;
      const wz = ax.z + dx * sinY + dz * cosY;
      p.x = wx; p.z = wz; p.vx = 0; p.vz = 0;
    }
  };

  let ticks = 0;
  while (s.stage !== 'DRIVE' && ticks < 900) { d.update(DT, NO_INPUT, new Set<string>()); seat(); ticks++; }
  assert(s.stage === 'DRIVE', `the scrum never reached DRIVE (stage=${s.stage}, ticks=${ticks})`);
  const poseAt = s.bindPose;
  const boundCount = s.poseLive.filter((v: number) => v === 1).length;

  /* ---- the real renderer, on the real rig ---- */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 400);
  const rendererStub: any = { capabilities: { getMaxAnisotropy: () => 8, maxTextureSize: 4096 } };
  const env = new ThreeEnvironment(scene, rendererStub);
  const canvasStub: any = { scene, camera, environment: env, renderer: rendererStub };
  const mgr = new ThreePlayerManager(canvasStub);
  await mgr.load();
  assert(mgr.ready, 'the rig did not load — the bind layer has nothing to pose');

  const view: any = { w: 1280, h: 720, scale: 1, ox: 0, oy: 0 };
  for (let i = 0; i < 6; i++) { d.update(DT, NO_INPUT, new Set<string>()); seat(); mgr.update(d, view, camera, DT); }

  const pool: Map<string, any> = (mgr as any).pool;
  const instOf = (team: string, num: number) => pool.get(`${team}:${num}`) ?? [...pool.values()]
    .find((i: any) => i.team === team && i.num === num);
  const world = (b: any): { x: number; y: number; z: number } => {
    b.updateWorldMatrix(true, false);
    return { x: b.matrixWorld.elements[12], y: b.matrixWorld.elements[13], z: b.matrixWorld.elements[14] };
  };
  const distM = (p: any, q: any) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / S;

  console.log(`scrum held on its slots: stage=${s.stage} pose=${fmt(poseAt, 2)} `
    + `bound=${boundCount}/16 ticks=${ticks} · rig=${[...pool.values()].length} bodies`);
  console.log('');

  /* ============================ (a) THE GRIPS ============================ */

  let worst = { d: 0, who: '', anchor: '' };
  const dump: { who: string; anchor: string; reach: number; maxReach: number; miss: number; handFromSh: number; body: string }[] = [];
  /* WHICH BODY IS THE HAND ON? A distance-to-anchor bound I invented would be a
   * number to argue with; this is not: for every grip, the nearest anatomical
   * anchor bone in either pack must belong to the man the socket NAMES. A grip
   * that lands on the wrong shoulder, the wrong pack, or the wrong row fails
   * here even when the IK delivered it faithfully — which is the failure mode
   * that actually matters when the layout moves. */
  const wrongBody: string[] = [];
  let grips = 0, missed = 0, noBone = 0;
  /* Bones are looked up by name on the loaded rig, NOT through the manager's
   * private lazy rig cache: a probe that reads a cache only populated as a side
   * effect of one render state is a probe that fails for reasons that have
   * nothing to do with the bind. */
  const boneOf = (inst: any, names: string[]): any => {
    for (const n of names) { const b = inst?.root?.getObjectByName(n); if (b) return b; }
    return null;
  };
  /** which bone the named anatomy lives on — read off the rig, not off the table */
  const anchorBone = (anchor: string, ref: any): any => {
    if (/thigh/.test(anchor)) return boneOf(ref, ['thigh_r', 'RightUpLeg']) ?? boneOf(ref, ['thigh_l', 'LeftUpLeg']);
    if (/waist|hip pocket/.test(anchor)) return boneOf(ref, ['spine_01', 'Spine']) ?? boneOf(ref, ['pelvis', 'Hips']);
    return boneOf(ref, ['spine_02', 'Spine1']) ?? boneOf(ref, ['spine_01', 'Spine']) ?? boneOf(ref, ['pelvis', 'Hips']);
  };
  /** the body a socket is measured against, resolved the way the engine resolves it */
  const refBodyOf = (team: 'A' | 'B', num: number, sk: any): any => {
    if (sk.ref === 'own') return instOf(team, num);
    if (sk.ref === 'mate') return instOf(team, sk.num);
    let best: any; let bestD = Infinity;
    for (const n of [1, 2, 3]) {
      const foe = instOf(team === 'A' ? 'B' : 'A', n);
      const p = d.L(team === 'A' ? 'B' : 'A', n);
      if (!foe) continue;
      const dd = Math.abs(p.x - d.L(team, num).x);
      if (dd < bestD) { bestD = dd; best = foe; }
    }
    return best;
  };

  for (const team of ['A', 'B'] as const) {
    for (const num of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sockets = PACK_BIND_SOCKETS[num];
      const inst = instOf(team, num);
      if (!inst || !sockets) { noBone++; continue; }
      const p = d.L(team, num);
      for (const sk of sockets) {
        /* where the engine told the renderer to put this hand */
        const sx = sk.hand === 'left' ? p.bindLX : p.bindRX;
        const sy = sk.hand === 'left' ? p.bindLY : p.bindRY;
        const sz = sk.hand === 'left' ? p.bindLZ : p.bindRZ;
        const sw = sk.hand === 'left' ? p.bindLW : p.bindRW;
        const boneName = sk.hand === 'left' ? (['hand_l', 'LeftHand'] as const) : (['hand_r', 'RightHand'] as const);
        const hand = boneName.map((n) => inst.root.getObjectByName(n)).find(Boolean) as any;
        if (!hand) { noBone++; continue; }
        if (!(sw > 0.5)) { missed++; continue; }   // not committed yet: not a grip to judge
        /* engine metres → the render world, on the manager's own mapping. The
         * height is read RELATIVE to this man's root, because the root carries
         * the turf crown: an absolute comparison would be scoring the pitch. */
        const hw = world(hand);
        const rootY = world(inst.root).y;
        const dSock = Math.hypot(
          hw.x - sx * S,
          (hw.y - rootY) - sy * S,
          hw.z + sz * S,        // z is flipped by the render mapping
        ) / S;
        const who = `${team}${num} ${sk.hand}`;
        if (dSock > worst.d) worst = { d: dSock, who, anchor: sk.anchor };
        {
          /* the shoulder THIS arm hangs from: reading the right shoulder for a
           * left-hand socket inflates the number by half the man's back and
           * turns a reachable grip into a false failure. */
          const ua = boneOf(inst, sk.hand === 'left'
            ? ['upperarm_l', 'LeftArm', 'mixamorigLeftArm']
            : ['upperarm_r', 'RightArm', 'mixamorigRightArm']);
          const shoulder = ua ? world(ua) : { x: 0, y: 0, z: 0 };
          const reach = Math.hypot(shoulder.x - sx * S, (shoulder.y - rootY) - sy * S, shoulder.z + sz * S) / S;
          const env = ((inst as any).scrumRest ? ((inst as any).scrumRest.up + (inst as any).scrumRest.fore) / S : 0);
          const handFromSh = Math.hypot(hw.x - shoulder.x, (hw.y - rootY) - (shoulder.y - rootY), hw.z - shoulder.z) / S;
          dump.push({ who, anchor: sk.anchor, reach, maxReach: env, miss: dSock, handFromSh, body: `${fmt(d.L(team,num).x,2)},${fmt(d.L(team,num).z,2)} sock: ${fmt(sx,2)},${fmt(sy,2)},${fmt(sz,2)}` });
        }
        /* and how far he is from the BODY PART, measured off the referenced
         * man's own bone — the check that would catch a socket that had drifted
         * off the anatomy it names while still being reached faithfully. */
        const refInst = refBodyOf(team, num, sk);
        const ab = refInst ? anchorBone(sk.anchor, refInst) : null;
        if (ab) {
          /* the nearest anchor bone of ANY of the sixteen */
          let bestD = Infinity, bestWho = '';
          for (const t2 of ['A', 'B'] as const) {
            for (const n2 of [1, 2, 3, 4, 5, 6, 7, 8]) {
              const b2 = instOf(t2, n2);
              const ab2 = b2 && anchorBone(sk.anchor, b2);
              if (!ab2) continue;
              const dd = distM(hw, world(ab2));
              if (dd < bestD) { bestD = dd; bestWho = `${t2}${n2}`; }
            }
          }
          const wantWho = `${sk.ref === 'opp' ? (team === 'A' ? 'B' : 'A') : team}${sk.num}`;
          /* THE ARM CLOSED ON THE BODY IT NAMES. Not "nearest body": a hand on a
           * 0.55 m arm reaching across a 0.52 m spacing sits between two spines by
           * construction, so a nearest-body rule is a coin toss that says nothing
           * about the bind. What is true, and what catches a grip on the wrong man
           * or a hand left hanging, is that the wrist is nearer the named body's
           * anchor than the binder's OWN hip is — the arm travelled to him — and
           * that it stayed inside the rig's measured envelope. Which body a socket
           * resolves to is a pure-arithmetic property, and it is tested as one
           * below, where no rig or renderer can excuse a wrong answer. */
          const dHand = distM(hw, world(ab));
          const myHip = world(boneOf(inst, ['pelvis', 'Hips'])!);
          const dHip = distM(myHip, world(ab));
          const env = inst.scrumRest
            ? (inst.scrumRest.up + inst.scrumRest.fore) / S : 0.55;
          if (dHand >= dHip) {
            wrongBody.push(`${who} (${sk.anchor}) did not close on ${wantWho}: wrist ${fmt(dHand)} m from his anchor vs ${fmt(dHip)} m from its own hip`);
          } else if (dHand > env + 0.12) {
            wrongBody.push(`${who} (${sk.anchor}) stops ${fmt(dHand)} m short of ${wantWho} — past the ${fmt(env)} m arm`);
          }
        }
        grips++;
      }
    }
  }

  check('(a) ALL SIXTEEN HANDS OF EACH PACK ARE MEASURED ON THE RIG', () => {
    assert(grips >= 32, `only ${grips} committed grips measured (want 32 = 16 per pack × 2); `
      + `pose=${fmt(poseAt, 2)} uncommitted=${missed} no-bone=${noBone}`);
  });
  if (process.env.BIND_DUMP) {
    console.log('  socket                      need   arm    hand@    miss   body->socket');
    for (const row of dump) {
      console.log(`  ${(row.who + ' ' + row.anchor).padEnd(27)} ${fmt(row.reach, 3)}  ${fmt(row.maxReach, 3)}  ${fmt(row.handFromSh, 3)}  ${fmt(row.miss, 3)}  ${row.body}`);
    }
    console.log('');
  }
  check('(a) EVERY GRIP SITS WITHIN 0.08 m OF ITS SOCKET', () => {
    assert(worst.d <= 0.08, `worst grip is ${fmt(worst.d)} m off (${worst.who} → ${worst.anchor}); `
      + 'the arm could not reach, or the aim is writing the wrong bone');
  });
  check('(a) EVERY GRIP CLOSED ON THE BODY ITS ANCHOR NAMES', () => {
    assert(wrongBody.length === 0, wrongBody.slice(0, 6).join('; ')
      + (wrongBody.length > 6 ? `; +${wrongBody.length - 6} more` : ''));
  });

  check('(a) EACH SOCKET RESOLVES TO THE BODY ITS ANCHOR NAMES', () => {
    /* Pure arithmetic over the same resolver the engine calls, with no rig and no
     * renderer in the loop: mirror the front rows, and a grip that had been
     * quietly authored onto the wrong man would move. That is the property the
     * layout can break and the 0.08 m test cannot see. */
    const bodies: any[] = [];
    for (const team of ['A', 'B'] as const) {
      for (const row of [1, 2, 3]) {
        const nums = row === 1 ? [1, 2, 3] : row === 2 ? [6, 4, 5, 7] : [8];
        nums.forEach((n, i) => bodies.push({
          team, num: n, row, x: (i - (nums.length - 1) / 2) * 0.52,
          z: (team === 'A' ? -1 : 1) * (0.30 + (row - 1) * 0.34),
          face: team === 'A' ? 1 : -1, hipY: 0.65,
        }));
      }
    }
    const pts = scrumBindSockets(bodies, 1);
    assert(pts.length === 32, `the resolver produced ${pts.length} grips for two packs, expected 32`);
    const a1 = pts.filter((q: any) => q.team === 'A' && q.num === 1);
    assert(a1.length === 2, `shirt 1 has ${a1.length} hands, expected 2`);
    const foe = bodies.find((q: any) => q.team === 'B' && q.num === 1)!;
    const mate = bodies.find((q: any) => q.team === 'A' && q.num === 2)!;
    const left = a1.find((q: any) => q.hand === 'left')!;
    const right = a1.find((q: any) => q.hand === 'right')!;
    const d = (q: any, b: any) => Math.hypot(q.x - b.x, q.z - b.z);
    assert(d(left, foe) < d(left, mate), `the loosehead's LEFT hand binds his own hooker (${fmt(d(left, mate), 2)} m) instead of the opponent across the tunnel (${fmt(d(left, foe), 2)} m)`);
    assert(d(right, mate) < d(right, foe), `the loosehead's RIGHT arm binds across the tunnel (${fmt(d(right, foe), 2)} m) instead of under his own hooker's armpit (${fmt(d(right, mate), 2)} m)`);
    /* and the anchors stay inside the reach envelope the renderer must honour */
    const reach = Math.hypot(left.x - bodies[0].x, left.z - bodies[0].z, left.y - (bodies[0].hipY + 0.42));
    assert(reach <= 0.36 + 0.02, `the loosehead's left grip is ${fmt(reach)} m out, past the 0.36 m authored envelope`);
  });

  /* ============================ (b) THE TUNNEL ============================ */

  const headFace = (inst: any): { yaw: number; deg: number } | null => {
    const head = inst.root.getObjectByName('Head') ?? inst.root.getObjectByName('head');
    if (!head) return null;
    head.updateWorldMatrix(true, false);
    /* the face, read as the bone's own forward: this rig runs its limbs down
     * local +Y, and its head turns about that axis, so the horizontal facing is
     * the bone's local +Z flattened onto the pitch. */
    const q = new THREE.Quaternion().setFromRotationMatrix(head.matrixWorld);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const yaw = Math.atan2(f.x, f.z);
    /* how far that is from the tunnel axis — the Z axis, either way along it */
    const off = Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw)));
    return { yaw, deg: Math.min(off, Math.PI - off) * 180 / Math.PI };
  };

  let worstHead = { deg: 0, who: '' };
  let headSeen = 0;
  const yaws: Record<string, number> = {};
  for (const team of ['A', 'B'] as const) {
    for (const num of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const inst = instOf(team, num);
      const h = inst && headFace(inst);
      if (!h) continue;
      headSeen++;
      if (h.deg > worstHead.deg) worstHead = { deg: h.deg, who: `${team}${num}` };
      if (yaws[team] === undefined) yaws[team] = h.yaw;
    }
  }
  check('(b) EVERY FORWARD FACES DOWN THE TUNNEL (±5°)', () => {
    assert(headSeen === 16, `only ${headSeen}/16 heads could be measured on the rig`);
    assert(worstHead.deg <= 5, `worst head is ${fmt(worstHead.deg, 2)}° off the engagement axis (${worstHead.who})`);
  });
  check('(b) THE TWO PACKS FACE EACH OTHER, NOT THE TOUCHLINE', () => {
    assert(yaws.A !== undefined && yaws.B !== undefined, 'a pack has no measurable heading');
    const apart = Math.abs(Math.atan2(Math.sin(yaws.A - yaws.B), Math.cos(yaws.A - yaws.B))) * 180 / Math.PI;
    assert(apart > 170, `the packs are ${fmt(apart, 1)}° apart; head-on is 180° — this is the rotated-pack class of bug`);
    /* and the authored truth agrees with what the rig is showing — through the
     * renderer's own mapping, which puts a heading of θ on rotation.y as π−θ. */
    const faceOf = (yaw: number) => Math.PI - yaw;
    const wrap = (v: number) => { let x = v; while (x > Math.PI) x -= Math.PI * 2; while (x < -Math.PI) x += Math.PI * 2; return x; };
    assert(Math.abs(wrap(faceOf(yaws.A) - scrumFacing('A'))) < 0.09,
      `pack A faces ${fmt(faceOf(yaws.A), 3)} rad, behaviour/ says ${fmt(scrumFacing('A'), 3)}`);
    assert(Math.abs(wrap(faceOf(yaws.B) - scrumFacing('B'))) < 0.09,
      `pack B faces ${fmt(faceOf(yaws.B), 3)} rad, behaviour/ says ${fmt(scrumFacing('B'), 3)}`);
  });

  /* ============================= (c) THE HEIGHT ============================= */

  let worstHip = { d: 0, who: '' };
  const hipDump: string[] = [];
  let worstFoot = { lift: 0, who: '' };
  let hips = 0;
  for (const team of ['A', 'B'] as const) {
    for (const num of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const inst = instOf(team, num);
      const p = d.L(team, num);
      if (!inst || p.hipY === undefined) continue;
      const pelvis = boneOf(inst, ['pelvis', 'Hips', 'mixamorigHips']);
      if (!pelvis) continue;
      /* the pelvis relative to the man's OWN origin, so the turf crown and the
       * root's lift under a fold cannot move the measurement. */
      const py = world(pelvis).y, ry = world(inst.root).y;
      const measured = (py - ry) / S;
      const e = Math.abs(measured - p.hipY);
      if (e > worstHip.d) worstHip = { d: e, who: `${team}${num}` };
      /* and the feet: the crouch is bought by the hips and knees, so an ankle
       * must not be dragged off the ground to make the pelvis fit. */
      for (const [i, side] of [[0, 'R'], [1, 'L']] as const) {
        const foot = boneOf(inst, i === 0 ? ['foot_r', 'RightFoot'] : ['foot_l', 'LeftFoot']);
        if (!foot) continue;
        const lift = (world(foot).y - ry) / S;
        const clipLift = 0.30;               // the Push clip's own ankle height
        if (lift - clipLift > worstFoot.lift) worstFoot = { lift: lift - clipLift, who: `${team}${num}${side}` };
      }
      if (false) {
        const pv = boneOf(inst, ['pelvis', 'Hips'])!;
        pv.updateWorldMatrix(true, false);
        const ps = new THREE.Vector3().setFromMatrixScale(pv.parent!.matrixWorld).y;
        hipDump.push(`  ${team}${num} want=${fmt(p.hipY)} got=${fmt(measured)} err=${fmt(e)} rootY=${fmt(world(inst.root).y)} parentScale=${fmt(ps)} state=${inst.proc.state} hipPub=${p.hipY === undefined ? 'no' : 'yes'}`);
      }
      hips++;
    }
  }
  if (process.env.BIND_DUMP && hipDump.length) { console.log('  --- hips ---'); console.log(hipDump.join('\n')); console.log(''); }
  check('(c) EVERY PACK MEMBER HOLDS HIS PUBLISHED HIP HEIGHT (±0.03 m)', () => {
    assert(hips === 16, `only ${hips}/16 forwards published a hip height this frame`);
    assert(worstHip.d <= 0.03, `worst hip is ${fmt(worstHip.d)} m off the published height (${worstHip.who}) `
      + '— the float the pose layer exists to remove is still there');
  });
  check('(c) THE FEET STAY ON THE TURF WHILE THE PELOVIS DROPS', () => {
    assert(worstFoot.lift <= 0.10, `an ankle rose ${fmt(worstFoot.lift)} m above its clip height (${worstFoot.who}) `
      + '— the pack is being lifted off the ground instead of bending at the hips');
  });
  check('(c) THE PUBLISHED HEIGHT IS A CROUCH, NOT A DENT IN THE POSE', () => {
    /* the number that used to be ignored: the gap between standing and the
     * authored front-row crouch. If this reads ~0 the pose was never published
     * and (c) is asserting nothing. */
    const drop = STANDING_PELVIS_Y - scrumHipY(1, 1);
    assert(drop > 0.25, `the authored crouch only moves the pelvis ${fmt(drop)} m — nothing to ground`);
    lines.push(`        (standing ${fmt(STANDING_PELVIS_Y, 2)} m → published front-row hip ${fmt(scrumHipY(1, 1), 2)} m: `
      + `${fmt(drop * 100, 1)} cm of pose the renderer used to leave un-drawn)`);
  });

  /* ============================ (d) THE COLLAPSE ============================ */

  let collapseSeen = false, why = '', folded = 0, whistle = false, hipOnDeck = -1;
  /* MEASUREMENT ONLY, no assertion: how big is the step off the deck? `releaseAll`
   * has always forced `grounded` -> `ready` for every set piece, so if a collapsed
   * prop's pelvis jumps half a metre in one frame here that is a SECOND and
   * different pop, owned by the falls system and not by the bind layer — and the
   * (e) snap check cannot see it, because a ragdoll-owned man is excluded there
   * on purpose. Numbers only, printed under DECKDUMP. */
  const prevDeck = new Map<string, number>();
  const hipBeforeCollapse = new Map<string, number>();
  const hipRose: string[] = [];
  const deckSteps: { who: string; d: number; from: number; to: number; clip: string; rag: string; fade: number; ctx: string }[] = [];
  const sampleDeck = () => {
    for (const [t9, n9] of [['A', 1], ['A', 2], ['A', 3], ['A', 5], ['B', 1], ['B', 2], ['B', 3]] as const) {
      const i9 = instOf(t9, n9);
      const pv = i9 && boneOf(i9, ['pelvis', 'Hips']);
      if (!pv) continue;
      const k9 = `${t9}${n9}`;
      const y9 = (world(pv).y - world(i9.root).y) / S;
      const p9 = prevDeck.get(k9);
      if (process.env.TRACE && n9 === 2 && d.scrim) {
        const a2 = instOf('A', 2);
        console.log(`    ST stage=${s.stage} t=${s.t.toFixed(2)} bindPose=${fmt(s.bindPose, 2)} blend=${fmt(s.collapseBlend, 2)} `
          + `risk=${fmt(s.collapseRisk, 2)} hipY=${d.L('A', 2).hipY === undefined ? '-' : fmt(d.L('A', 2).hipY!, 3)} `
          + `cw=${fmt(d.L('A', 2).collapseW ?? -1, 2)} pose=${a2?.proc?.state} y=${a2 ? fmt((world(boneOf(a2, ['pelvis', 'Hips'])!).y - world(a2.root).y) / S, 3) : '-'}`);
      }
      if (process.env.TRACE && n9 === 1) {
        console.log(`    TR ${k9} y=${fmt(y9, 3)} fade=${(i9.scrumFade ?? 0).toFixed(3)} `
          + `snapFold=${(i9.scrumPose?.fold ?? 0).toFixed(2)} pitch=${i9.root.rotation.x.toFixed(3)} `
          + `hipY=${d.L(t9, n9).hipY === undefined ? '-' : fmt(d.L(t9, n9).hipY!, 2)} `
          + `cw=${d.L(t9, n9).collapseW === undefined ? '-' : fmt(d.L(t9, n9).collapseW!, 2)} `
          + `clip=${d.L(t9, n9).clip} rag=${i9.rag ? 'Y' : 'n'} ragW=${(i9.proc?.ragW ?? 0).toFixed(2)} scrim=${d.scrim ? 'live' : 'gone'}`);
      }
      if (p9 !== undefined && Math.abs(y9 - p9) > 0.05) {
        deckSteps.push({ who: k9, d: y9 - p9, from: p9, to: y9, clip: d.L(t9, n9).clip ?? '?', rag: i9.rag ? 'ragdoll' : 'posed',
          fade: i9.scrumFade ?? 0,
          ctx: `fade=${(i9.scrumFade ?? 0).toFixed(2)} ragW=${(i9.proc?.ragW ?? 0).toFixed(2)} `
            + `pose=${i9.proc?.state} scrim=${d.scrim ? s.stage : 'gone'}` });
      }
      prevDeck.set(k9, y9);
    }
  };
  {
    /* FORCE it: yank a bound loosehead off his seat and hold him there. That is
     * a front row losing its bind, which is the cause the floor measures. */
    for (let i = 0; i < 200; i++) {
      /* seat the pack, then drag BOTH props off their seats — their binds were
       * HELD, so this is a front row coming apart, which is what the floor measures */
      for (const slot of s.players) {
        if (slot.team === 'A' && (slot.num === 1 || slot.num === 3)) continue;
        const q = d.L(slot.team, slot.num);
        const dx = slot.x - ax.x, dz = slot.z - ax.z + s.netDrive;
        q.x = ax.x + dx; q.z = ax.z + dz; q.vx = 0; q.vz = 0;
      }
      d.update(DT, NO_INPUT, new Set<string>());
      /* PIN him off his bind, do not nudge him: placeBound pulls a loose forward
       * back to his seat inside a frame, and a test that loses that argument is
       * measuring the recovery, not the collapsed bind it means to stage. */
      /* BOTH props held a full tolerance beyond their seats — by moving the
       * SEATS, not the men. The first version teleported the players a metre a
       * frame, and the engine answered exactly as it is built to: a man two
       * tolerances off his bind has lost his height, so his PUBLISHED hip height
       * dropped 0.28 m in that frame. That is a correct response to an input the
       * game never produces (no forward moves a metre between ticks), and it
       * poisoned the rate measurement below. Displacing each prop's mark from
       * where he actually stands keeps `off` past the tolerance while his own
       * trajectory stays engine-driven and bounded, which is what a pack being
       * wrenched apart looks like. One drifter is still not a fallen row: the
       * front row's height is read at the median of three, so both props go. */
      for (const n of [1, 3]) {
        const q = d.L('A', n);
        const slot = s.players.find((x: any) => x.team === 'A' && x.num === n)!;
        slot.x = q.x + 0.95; slot.z = q.z - 1.05;
      }
      /* THE DIRECTION OF THE FALL, on the published channel rather than the drawn
       * one: a collapse is the pack going DOWN, so the height the engine prices
       * may never climb when the fold starts. The rate check below cannot see a
       * version of this that glides instead of jumping — with `bindPose` zeroed at
       * COLLAPSE the hips rise to standing height (0.4 m of travel) and the rate
       * limiter simply makes that climb graceful, which is a nicer way to be
       * wrong. This one notices either way. */
      if (d.scrim) {
        for (const [t8, n8] of [['A', 1], ['A', 2], ['A', 3], ['B', 1], ['B', 2], ['B', 3]] as const) {
          const h8 = d.L(t8, n8).hipY;
          if (h8 === undefined) continue;
          const k8 = `${t8}${n8}`;
          if (s.stage === 'COLLAPSE') {
            const before = hipBeforeCollapse.get(k8);
            if (before !== undefined && h8 > before + 0.02) {
              hipRose.push(`${k8} ${fmt(before, 2)} -> ${fmt(h8, 2)} m as the fold began`);
            }
          } else hipBeforeCollapse.set(k8, h8);
        }
      }
      mgr.update(d, view, camera, DT);
      sampleDeck();
      if (s.collapseSeen) { collapseSeen = true; why = s.collapse?.why ?? ''; }
      /* the fold is animated over FOLD_S and the whistle lands after WHISTLE_S:
       * both have to be RUN THROUGH, which is why this loop keeps going once the
       * collapse has been seen instead of stopping at its first frame */
      if (s.stage === 'COLLAPSE') {
        folded = Math.max(folded, s.collapseBlend);
        for (const team of ['A', 'B'] as const) {
          for (const num of [1, 2, 3]) {
            const inst = instOf(team, num);
            const pelvis = inst && boneOf(inst, ['pelvis', 'Hips']);
            if (pelvis) hipOnDeck = (world(pelvis).y - world(inst.root).y) / S;
          }
        }
      }
      if (calls.includes('COLLAPSE')) whistle = true;
      if (s.stage === 'COLLAPSE') folded = Math.max(folded, s.collapseBlend);
      if (whistle) break;
    }
  }

  for (let i = 0; i < 60; i++) { d.update(DT, NO_INPUT, new Set<string>()); mgr.update(d, view, camera, DT); sampleDeck(); }
  if (process.env.DECKDUMP) {
    const byWho = new Map<string, number>();
    for (const st of deckSteps) byWho.set(st.who, Math.max(byWho.get(st.who) ?? 0, Math.abs(st.d)));
    const big = deckSteps.filter((st) => Math.abs(st.d) > 0.12)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10);
    console.log(`  --- deck steps: ${deckSteps.length} frames with a >5 cm move, ${big.length} over 12 cm; `
      + `worst per man: ${[...byWho.entries()].map(([k, v]) => `${k} ${fmt(v, 2)}`).join(' ')} ---`);
    for (const st of big) console.log(`      ${st.who} ${fmt(st.from, 2)} -> ${fmt(st.to, 2)} m (${fmt(st.d, 2)}) clip=${st.clip} ${st.rag} ${st.ctx}`);
  }

  check('(d) A COLLAPSING PACK GOES DOWN — NO HIP CLIMBS AS THE FOLD STARTS', () => {
    assert(hipRose.length === 0, hipRose.slice(0, 4).join('; ')
      + (hipRose.length > 4 ? `; +${hipRose.length - 4} more` : '')
      + ' — the pack stood up on its way to the deck, which is what zeroing the '
      + 'bind pose at COLLAPSE does to a height that was already sagged');
  });
  check('(d) THE COLLAPSE IS RAMPED, NOT CUT — NO MAN TELEPORTS TO THE DECK', () => {
    /* the rate, not just the endpoint: (d) used to assert the front row ARRIVES
     * on the deck, and it did — in one frame, from standing height, twice. Two
     * separate defects lived behind that pass: the render layer selected the
     * deck height the instant `collapseW` was nonzero (a cliff, not a fold), and
     * the engine published STANDING height on the collapse's first frame because
     * `bindPose` goes to zero when the bind is released. Both are measured here
     * as one number: what a bound man's pelvis is allowed to move in a frame.
     * 0.15 m at 50 Hz is 7.5 m/s of hip, well above any legal crouch or fold
     * rate and far below the 0.41-0.83 m steps the two cliffs produced. */
    /* only the frames the pose layer was WRITING. A man in the falls system is
     * blended by `ragW` and belongs to that solver's budget, not this one's —
     * counting his hand-back as a scrum defect is how a check starts losing
     * arguments with the wrong defendant. */
    const ours = deckSteps.filter((st) => st.fade > 0.001);
    const worst = ours.reduce((m, st) => Math.max(m, Math.abs(st.d)), 0);
    const cut = ours.filter((st) => Math.abs(st.d) > 0.15);
    if (process.env.BIND_DUMP) console.log(`        (${deckSteps.length} moves over 5 cm; ${ours.length} of them written by the `
      + `pose layer, ${cut.length} of those over the 0.15 m rate; ${deckSteps.length - ours.length} belong to the falls blend)`);
    assert(cut.length === 0, `${cut.length} of ${deckSteps.length} big moves exceed 0.15 m in one frame `
      + `(worst ${fmt(worst, 2)} m: ${cut.slice(0, 3).map((st) => `${st.who} ${fmt(st.from, 2)}->${fmt(st.to, 2)} @${st.ctx}`).join('; ')}) `
      + '— the collapse is being cut, not folded');
  });

  check('(d) THE FRONT ROW COMING DOWN IS SEEN (collapseSeen)', () => {
    assert(collapseSeen, 'a bound prop held 1.5 m off his seat never collapsed the scrum');
    assert(s.collapseSeen === true, 'collapseSeen did not latch on the scrum state');
    assert(why === 'HIP Y FLOOR', `collapsed for "${why}", expected the hip floor — the measured cause, not the roll`);
  });
  check('(d) THE FRONT ROW FOLDS TO THE TURF AND THE PACK SLIDES INTO IT', () => {
    assert(folded > 0.9, `the fold only reached ${fmt(folded, 2)} of 1 — a pack left half-collapsed`);
    assert(hipOnDeck >= 0 && hipOnDeck < 0.28, `the collapsed front row's pelvis is at ${fmt(hipOnDeck)} m — `
      + 'it should be on the deck');
  });
  check('(d) THE WHISTLE TEARS THE PHASE DOWN CLEANLY', () => {
    assert(whistle, 'no COLLAPSE law call reached the referee');
    assert(d.phase !== 'SCRUM' || !d.scrim || d.scrim.stage !== 'COLLAPSE',
      'the scrum is still in COLLAPSE after the whistle — the fold never ends');
  });

  /* ============================ (e) THE RELEASE ============================
   * WHAT THE PACK LOOKS LIKE AFTER THE SCRUM. The bind pose is a debt to the
   * animation: sixteen men were written on top of their clips, and every one of
   * those writes has to be UNWRITTEN when the phase ends — otherwise the man
   * carries the scrum with him. A pelvis still pinned at crouch height. An arm
   * still aimed at the shirt of a man he has left, which is the "arm stretched
   * out behind him" the eye reads first. An ankle still planted where the pack
   * stood while he runs 1.5 m past it, which is the leg bending backwards. A
   * root still pitched over by the fold.
   *
   * SCENARIO: a CLEAN whistle at full bind, on a scrum that was never dragged
   * apart. (d) ends its phase through a collapse, which zeroes the grips on its
   * own way out and hands the front row to the falls system — a good test of the
   * fold, a poor one of the release, because a man rising off the deck is
   * *supposed* to be pitched over and any pose residue hides inside that. Here
   * the last thing the engine wrote was a crouch and two grips at commit 1, and
   * play resumes standing: any leftover is unambiguous.
   *
   * THE RULERS ARE THE MEN'S OWN BONES. No threshold here is a guess about
   * anatomy: the arm envelope is the loaded rig's measured segment lengths, and
   * the "is his elbow pointing backwards" band is taken from eleven backs and
   * wings who were never within a metre of a scrum, sampled on the same frames.
   */
  {
    /* ITS OWN MATCH AND ITS OWN RIG. (d) ends with the front row mid-get-up: the
     * falls system owns their roots, their pelvises are on the deck and their
     * arms are wherever a thrown body left them. That is nothing to the point
     * under test, and it would swallow every number below, so this section pays
     * for a second rig load and starts from a clean Director: a scrum that binds,
     * drives, and is then simply whistled, with nothing else having happened. */
    seedRng(11);
    const d2: any = new Director(gateConfig(6));
    const mgr2: any = new ThreePlayerManager(canvasStub);
    await mgr2.load();
    assert(mgr2.ready, 'the rig did not load for the release scenario');
    const pool2: Map<string, any> = (mgr2 as any).pool;
    const pick = (team: string, num: number) => pool2.get(`${team}:${num}`)
      ?? [...pool2.values()].find((i: any) => i.team === team && i.num === num);

    d2.startScrum('B', 0, 0);
    const s2 = d2.scrim;
    assert(!!s2, 'no scrum to release — the scenario never started');
    const ax2 = d2.scrumAnchor;
    const seat2 = () => {
      const yaw = (s2.yaw * Math.PI) / 180;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      for (const slot of s2.players) {
        const p = d2.L(slot.team, slot.num);
        const dx = slot.x - ax2.x, dz = slot.z - ax2.z + s2.netDrive;
        p.x = ax2.x + dx * cosY - dz * sinY;
        p.z = ax2.z + dx * sinY + dz * cosY;
        p.vx = 0; p.vz = 0;
      }
    };
    let t2 = 0;
    while (s2.stage !== 'DRIVE' && t2 < 900) {
      d2.update(DT, NO_INPUT, new Set<string>()); seat2(); mgr2.update(d2, view, camera, DT); t2++;
    }
    for (let i = 0; i < 4; i++) { d2.update(DT, NO_INPUT, new Set<string>()); seat2(); mgr2.update(d2, view, camera, DT); }
    assert(s2.stage === 'DRIVE', `the release scrum never reached DRIVE (stage=${s2.stage})`);
    const live2 = s2.poseLive.filter((v: number) => v === 1).length;
    assert(live2 === 16, `only ${live2}/16 forwards were live when the whistle blew`);
    /* the state the symptom needs: grips committed and hips published, so the
     * release has something real to take away */
    let committed = 0;
    for (const team of ['A', 'B'] as const) {
      for (const num of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const p = d2.L(team, num);
        if ((p.bindLW ?? 0) > 0.5 && (p.bindRW ?? 0) > 0.5) committed++;
      }
    }
    assert(committed >= 12, `only ${committed}/16 had committed grips — nothing to strand`);

    /* THE WHISTLE, at full bind. `releaseAll()` is the referee's actual teardown
     * (it clears `scrim` among everything else), and the publish loop lives
     * inside the scrum — so from this frame on, nothing is written about these
     * sixteen unless something also writes the UNWRITING. */
    d2.releaseAll();
    assert(!d2.scrim, 'releaseAll() left a scrum in place');

    /* THE RULERS. `env` is the rig's own segment lengths, measured off the bones
     * it loaded with. The comparator is eleven backs and wings who never bound to
     * anything, sampled on the SAME frames under the SAME filter, because "is
     * that arm too straight?" is only answerable against what this animation does
     * to an arm by itself. No threshold below is a guess about anatomy; each one
     * is the control group's own worst frame plus a small allowance. */
    const envOf = (inst: any) => (inst.scrumRest
      ? { arm: (inst.scrumRest.up + inst.scrumRest.fore) / S, leg: (inst.scrumRest.thigh + inst.scrumRest.calf) / S }
      : null);
    /* the backs never entered a scrum, so they never had the rig's segment
     * lengths measured off them — and measuring them off a JOG frame would
     * under-read a bent elbow and flatter the comparison. There is one skeleton
     * in this file, so the pack's own measured envelope is the ruler for both
     * groups: same number in the denominator, apples against apples. */
    const RULER = envOf(pick('A', 1));
    assert(!!RULER, 'no rig, no ruler: the release checks need measured segment lengths');
    const env = (inst: any) => envOf(inst) ?? RULER!;
    const armRatio = (inst: any) => {
      let r = 0, back = 0;
      for (const [uaN, elN, hN] of [['upperarm_r', 'lowerarm_r', 'hand_r'], ['upperarm_l', 'lowerarm_l', 'hand_l']] as const) {
        const ua = boneOf(inst, [uaN]), el = boneOf(inst, [elN]), hd = boneOf(inst, [hN]);
        if (!ua || !el || !hd) continue;
        r = Math.max(r, distM(world(hd), world(ua)) / env(inst).arm);
        /* how far BEHIND his own shoulder the elbow sits, in render units: the
         * "stretched out behind them" read, without a magic angle. */
        back = Math.max(back, -(world(el).x - world(ua).x) / S);
      }
      return { r, back };
    };
    const legRatio = (inst: any) => {
      let r = 0;
      for (const [thN, fN] of [['thigh_r', 'foot_r'], ['thigh_l', 'foot_l']] as const) {
        const th = boneOf(inst, [thN]), ft = boneOf(inst, [fN]);
        if (!th || !ft) continue;
        r = Math.max(r, distM(world(ft), world(th)) / env(inst).leg);
      }
      return r;
    };
    const hipsOf = (inst: any) => {
      const pelvis = boneOf(inst, ['pelvis', 'Hips']);
      return pelvis ? (world(pelvis).y - world(inst.root).y) / S : null;
    };
    /** how far a bone sits BEHIND another, along the man's own facing, metres.
     * Projected on his axis rather than read off one world coordinate: these men
     * run down the pitch, and an X-only measure of a Z-facing pack is noise. */
    const _fwd = new THREE.Vector3();
    const _fquat = new THREE.Quaternion();
    const behind = (inst: any, front: string, rear: string) => {
      const a = boneOf(inst, [front]), b = boneOf(inst, [rear]);
      if (!a || !b) return 0;
      inst.root.getWorldQuaternion(_fquat);
      _fwd.set(0, 0, 1).applyQuaternion(_fquat);
      const va = world(a), vb = world(b);
      return -(((vb.x - va.x) * _fwd.x + (vb.z - va.z) * _fwd.z) / S);
    };
    /** upright and untroubled: a man the falls system owns, or a clip that has him
     * on the deck, is not evidence about a bind pose. Applied to the controls too,
     * so nobody is judged for somebody else's tackle. */
    const judgeable = (dd: any, team: string, num: number) => {
      const inst = pick(team, num);
      const p = dd.L(team, num);
      if (!inst || !p) return false;
      if (inst.rag || (inst.proc?.ragW ?? 0) > 0.05 || p.down) return false;
      return !/ground|getup|tackle|jackal|roll|fall|div|celebr|press/.test(p.clip ?? '');
    };
    const CONTROLS = ['A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'B9', 'B10', 'B11', 'B15']
      .map((k) => [k[0], +k.slice(1)] as const);
    /* the window: frame 20 is 0.4 s after the whistle, so the release (0.35 s)
     * has finished; frame 110 is before a goalless scrimmage has much chance to
     * start putting men on the floor and muddying the sample. */
    const FROM = 20, TO = 110;

    let lastActive = -1;
    const snap: { d: number; who: string; at: number } = { d: 0, who: '', at: 0 };
    const worst = { arm: { r: 0, who: '' }, leg: { r: 0, who: '' }, back: { v: 0, who: '' }, pitch: { d: 0, who: '' }, hip: { lo: 9, hi: -9, who: '' } };
    const ctrl = { arm: 0, leg: 0, back: 0, pitch: 0, trail: 0 };
    const stuck: string[] = [];
    const snapTrail: { d: number; who: string; at: number } = { d: 0, who: '', at: 0 };
    const prevHip = new Map<string, number>();
    let frames = 0, judged = 0;
    for (let i = 0; i < 140; i++) {
      d2.update(DT, NO_INPUT, new Set<string>());
      mgr2.update(d2, view, camera, DT);
      frames++;
      for (const team of ['A', 'B'] as const) {
        for (const num of [1, 2, 3, 4, 5, 6, 7, 8]) {
          const key = `${team}${num}`;
          const inst = pick(team, num);
          if (!inst) continue;
          const p = d2.L(team, num);
          /* the layer is "still writing" if the engine is publishing a pose OR
           * the renderer is still fading one out. Both channels are checked on
           * every man on every frame: a stranded channel is a stranded channel
           * whether or not he is currently upright. */
          const active = (inst.scrumFade ?? 0) > 0.001 || inst.actor.hipY !== undefined;
          if (active && i < 70) lastActive = i;
          if (i >= FROM) {
            if (p.hipY !== undefined) stuck.push(`${key} Live.hipY=${fmt(p.hipY, 2)} at f${i}`);
            if (p.collapseW) stuck.push(`${key} Live.collapseW=${fmt(p.collapseW, 2)} at f${i}`);
            if (p.bindLW || p.bindRW) stuck.push(`${key} Live grips=${fmt(p.bindLW ?? 0, 2)}/${fmt(p.bindRW ?? 0, 2)} at f${i}`);
            if (inst.actor.hipY !== undefined) stuck.push(`${key} Actor.hipY still set at f${i}`);
            if ((inst.scrumFade ?? 0) > 0.001) stuck.push(`${key} scrumFade=${fmt(inst.scrumFade ?? 0, 3)} at f${i}`);
          }
          /* DURING THE FADE: how far behind his own hip is his foot being dragged
           * while the release is running? The planted ankle is the only goal in
           * this layer that was remembered in a frame other than his own, so this
           * is the one number that says whether remembering it in HIS frame rather
           * than the world's is load-bearing. */
          if (active && i < FROM) {
            const bt = Math.max(behind(inst, 'thigh_r', 'foot_r'), behind(inst, 'thigh_l', 'foot_l'));
            if (bt > snapTrail.d) { snapTrail.d = bt; snapTrail.who = key; snapTrail.at = i; }
          }
          const h = hipsOf(inst);
          const was = prevHip.get(key);
          prevHip.set(key, h ?? 0);
          /* the departure, measured only while OUR layer is writing (once it has
           * let go, whatever the clips do is not this test's business) and never
           * on a man the falls system has taken over */
          /* measured across the whole departure, not only the frames the layer was
           * writing: a CUT out of the pose shows up as one big jump on the first
           * frame the layer has stopped, and a check that only looks while the
           * layer is active is blind to exactly the thing it means to catch. */
          if (was !== undefined && h !== null && i <= FROM && !inst.rag) {
            const dj = Math.abs(h - was);
            if (dj > snap.d) { snap.d = dj; snap.who = key; snap.at = i; }
          }
          if (i < FROM || i > TO || !judgeable(d2, team, num)) continue;
          judged++;
          const a = armRatio(inst), lr = legRatio(inst);
          if (a.r > worst.arm.r) worst.arm = { r: a.r, who: key };
          if (a.back > worst.back.v) worst.back = { v: a.back, who: key };
          if (lr > worst.leg.r) worst.leg = { r: lr, who: key };
          const pit = Math.abs(inst.root.rotation.x);
          if (pit > worst.pitch.d) worst.pitch = { d: pit, who: `${key}@f${i}` };
          if (h !== null) {
            if (h < worst.hip.lo) worst.hip = { lo: h, hi: worst.hip.hi, who: `${key}@f${i}` };
            if (h > worst.hip.hi) worst.hip = { lo: worst.hip.lo, hi: h, who: `${key}@f${i}` };
          }
        }
      }
      if (i <= TO) {
        for (const [t3, n3] of CONTROLS) {
          if (!judgeable(d2, t3, n3)) continue;
          const ci = pick(t3, n3);
          if (!ci) continue;
          /* the same leg trail on a back over the same frames: what a sprint
           * stride does to a foot is not a defect, so the band has to know it.
           * Sampled while the release is running (i < FROM) and after. */
          if (i < FROM) {
            ctrl.trail = Math.max(ctrl.trail, behind(ci, 'thigh_r', 'foot_r'), behind(ci, 'thigh_l', 'foot_l'));
            continue;
          }
          const ca = armRatio(ci);
          ctrl.arm = Math.max(ctrl.arm, ca.r);
          ctrl.back = Math.max(ctrl.back, ca.back);
          ctrl.leg = Math.max(ctrl.leg, legRatio(ci));
          ctrl.pitch = Math.max(ctrl.pitch, Math.abs(ci.root.rotation.x));
        }
      }
    }
    if (process.env.BIND_DUMP) {
      console.log(`  --- release: ${frames} frames, ${judged} judged · last active pose frame=${lastActive} `
        + `· snap=${fmt(snap.d, 3)} m @f${snap.at} (${snap.who})`);
      console.log(`      forwards worst: arm ${fmt(worst.arm.r, 3)}x (${worst.arm.who}) leg ${fmt(worst.leg.r, 3)}x (${worst.leg.who}) `
        + `elbow-back ${fmt(worst.back.v, 3)} m pitch ${fmt(worst.pitch.d, 3)} rad hips ${fmt(worst.hip.lo, 2)}..${fmt(worst.hip.hi, 2)}`);
      console.log(`      during the fade: worst foot-trail-behind-hip ${fmt(snapTrail.d, 3)} m (${snapTrail.who} @f${snapTrail.at}) `
        + `vs control ${fmt(ctrl.trail, 3)} m`);
      console.log(`      controls worst: arm ${fmt(ctrl.arm, 3)}x leg ${fmt(ctrl.leg, 3)}x elbow-back ${fmt(ctrl.back, 3)} m pitch ${fmt(ctrl.pitch, 3)} rad`);
    }

    check('(e) THE WHISTLE CLOSES EVERY POSE CHANNEL', () => {
      assert(stuck.length === 0, stuck.slice(0, 5).join('; ')
        + (stuck.length > 5 ? `; +${stuck.length - 5} more stranded channels across ${TO - FROM} frames` : ''));
    });
    check('(e) THE POSE LAYER LETS GO WITHIN HALF A SECOND', () => {
      assert(lastActive <= 25, `the pose layer was still writing at frame ${lastActive} `
        + '(more than 0.5 s after the whistle) — the release never finishes');
    });
    check('(e) A RELEASED FORWARD IS AS UPRIGHT AS A BACK', () => {
      assert(judged > 300, `only ${judged} upright forward-frames were judged — the scenario is not measuring anything`);
      assert(worst.hip.lo > 0.70 && worst.hip.hi < 1.12, `a released forward's pelvis sat at `
        + `${fmt(worst.hip.lo, 2)}..${fmt(worst.hip.hi, 2)} m (${worst.hip.lo < 0.70 ? worst.hip.who : worst.hip.hi > 1.12 ? worst.hip.who : ''}) `
        + '— he is still holding the scrum shape after the whistle');
    });
    check('(e) NO ARM IS LEFT REACHING AT THE MAN HE USED TO HOLD', () => {
      assert(worst.back.v <= ctrl.back + 0.15, `an elbow sits ${fmt(worst.back.v, 2)} m behind its shoulder `
        + `(${worst.back.who}) where a back who never scrummed manages ${fmt(ctrl.back, 2)} m — `
        + 'the grip is still aiming at a body that has gone');
      assert(worst.arm.r <= ctrl.arm + 0.06, `a released forward's arm is drawn at ${fmt(worst.arm.r * 100, 1)}% `
        + `of its span (${worst.arm.who}) against a control band of ${fmt(ctrl.arm * 100, 1)}% — a locked elbow`);
    });
    check('(e) NO LEG IS LEFT PLANTED WHERE THE PACK STOOD', () => {
      assert(worst.leg.r <= ctrl.leg + 0.05, `a released forward's leg is drawn ${fmt(worst.leg.r * 100, 1)}% of `
        + `thigh+calf (${worst.leg.who}) against a control band of ${fmt(ctrl.leg * 100, 1)}% — he is still being `
        + 'held to an ankle the pack planted, which is the knee bending backwards');
    });
    check('(e) NO FORWARD WALKS OUT STILL FOLDED', () => {
      assert(worst.pitch.d <= ctrl.pitch + 0.04, `a released forward's root is pitched ${fmt(worst.pitch.d * 57.3, 1)}`
        + ` degrees (${worst.pitch.who}) where the fold is ${fmt(SCRUM_COLLAPSE.PITCH_DEG, 1)} and a back reaches `
        + `${fmt(ctrl.pitch * 57.3, 1)} degrees — the collapse was never handed back`);
    });
    check('(e) NO FOOT IS DRAGGED BEHIND A RUNNING MAN BY THE RELEASE', () => {
      assert(snapTrail.d <= ctrl.trail + 0.25, `during the release a forward's foot was ${fmt(snapTrail.d, 2)} m behind `
        + `his own thigh (${snapTrail.who} @f${snapTrail.at}) where a sprinting back trails ${fmt(ctrl.trail, 2)} m — `
        + 'the planted ankle is being remembered in the world instead of in him');
    });
    check('(e) THE PACK LEAVES THE POSE WITHOUT A SNAP', () => {
      assert(snap.d <= 0.12, `a released forward's pelvis moved ${fmt(snap.d)} m in one frame (${snap.who}, f${snap.at}) `
        + '— the pose is being cut out from under him, not faded');
    });
  }

  /* ================= (f) THE OTHER TWO SET PIECES LET GO TOO ================= */
  {
    /* WHY THIS IS A MEASUREMENT AND NOT A READING OF THE CODE. `placeBound()` is
     * one function that poses all three set pieces, and the scrum is the one that
     * leaked: `hipY`, `collapseW` and the two bind weights have NO other writer in
     * the tree, so tearing `scrim` down undid nothing. The question for a maul and
     * a lineout is therefore not "did they forget a clear" but "is any channel they
     * write on a BODY the same lonely shape". Per channel, measured below rather
     * than asserted from a reading:
     *
     *   `p.clip`        — re-derived every frame by the gait picker
     *                     (intelligence.ts) for any man who is not `bound`; and
     *                     `bound` is not latched either — think() rebuilds the claim
     *                     set from the LIVE structures each frame (isBound over
     *                     boundNums), so a dead structure loses its men on the next
     *                     frame and the picker takes them back. MEASURED, because it
     *                     turned out the two systems do not lean on this equally: a
     *                     maul claims all sixteen (`bound 16`), a LINEOUT CLAIMS
     *                     NONE (measured 0 across its whole approach) — the lineout
     *                     steers free agents onto slots, so nothing has to be
     *                     released, which is why the three release mechanisms below
     *                     can all be removed at once and only the maul cases go red. This is the ONLY
     *                     thing that poses a maul or lineout man: the renderer's
     *                     upright torso is `case 'bind': → 'Push'` and the overhead
     *                     press is `case 'jump': → 'JumpLand'`, both chosen by the
     *                     clip name and nothing else.
     *   `a.renderClip`  — `syncActors` copies `p.clip` onto the published actor
     *                     UNCONDITIONALLY every frame (director.ts:7835), so the
     *                     renderer can never be left holding a name the engine has
     *                     already let go of. The scrum's four channels are copied
     *                     behind an `if (p.hipY !== undefined)`, which is exactly
     *                     why they stranded and this cannot.
     *   `p.face`        — steer() derives it from the velocity vector.
     *   `p.jumpY`       — `tickJump` integrates all thirty men every frame whatever
     *                     the phase and zeroes itself at landing; `releaseAll`
     *                     writes 0 outright. THE LINEOUT NEVER TOUCHES IT AT ALL:
     *                     grep finds no writer in setpieces.ts, which is the answer
     *                     to "is the 2.x m plane purged on catch/maul/whistle" —
     *                     there is no per-actor plane to purge. The plane and the
     *                     lifters' hand heights (`handY`, 2.6 m at a catch) live on
     *                     LineoutState's own roster and die with `d.lo`, so the
     *                     check below is that the object is gone and that nothing
     *                     was mirrored out of it.
     *
     *   `gazeX/gazeZ`   — the binders' gaze, if a maul had one, would strand here.
     *                     It does not: `syncActors` writes
     *                     `a.ballLookX = watching ? point : undefined` — the
     *                     ELSE-BRANCH that the scrum's four channels never had — and
     *                     `releaseAll` clears every actor's look anyway (director.ts
     *                     :7825 and :6355). No assertion is written for it, because
     *                     a check that cannot fail is not an instrument.
     *
     * There is therefore nothing for a `clearMaulPose()` to zero, and adding one
     * would be a function whose only content is a comment. What this audit ships
     * instead is the window: five real exit paths, each measured for the worst and
     * the LAST frame of 1.2 s of open play, on five claims a set piece can leave on
     * a body. Worst AND last because the defect class this pass exists for was a
     * one-frame cliff, not a permanent one. */
    const CLIPS_POSE = new Set([
      'maulBind', 'maulDrive', 'maulPush',
      'lineoutJump', 'lineoutLift', 'lineoutStand', 'lineoutThrow',
      'scrumBind', 'scrumCrouch', 'scrumDrive', 'nineSquat', 'ninePass', 'nineFeed',
    ]);
    const JOB_PHRASE = /MAUL|LINEOUT|SCRUM|TUNNEL|THE PACK|CROUCH/;
    const claimOf = (p: any) => (p.hipY !== undefined || p.collapseW || p.bindLW || p.bindRW) ? 1 : 0;

    const step1 = (dd: any) => dd.update(DT, NO_INPUT, new Set<string>());
    const fresh = (seed: number) => { seedRng(seed); return new Director(gateConfig(6)) as any; };
    /** run until the predicate holds, capped; -1 = never */
    const until = (dd: any, pred: () => boolean, cap: number) => {
      for (let f = 0; f < cap; f++) { if (pred()) return f; step1(dd); }
      return pred() ? cap : -1;
    };
    const claimCount = (dd: any) => {
      let n = 0;
      for (const p of dd.live) if (p.bound) n++;
      return n;
    };
    const poseWearers = (dd: any) => {
      let n = 0;
      for (const p of dd.live) if (p.clip && CLIPS_POSE.has(p.clip)) n++;
      return n;
    };
    type Cell = { worst: number; last: number; who: string; at: number };
    const sweep = (dd: any, frames = 60) => {
      const out: Record<string, Cell> = {};
      const acc = (k: string, n: number, who: string, f: number) => {
        const r = out[k] ?? (out[k] = { worst: 0, last: 0, who: '', at: -1 });
        if (n > r.worst) { r.worst = n; r.who = who; r.at = f; }
        r.last = n;
      };
      for (let f = 0; f < frames; f++) {
        step1(dd);
        /* a live structure legitimately owns these men; residue only counts when
         * nothing does. */
        const owned = !!(dd.ml || dd.lo || dd.scrim || dd.bd);
        let cn = 0, cw = '', bn = 0, bw = '', hn = 0, hw = '', jn = 0, jw = '', mn = 0, mw = '';
        for (const p of dd.live) {
          const who = `${p.team}${p.num}`;
          if (!owned && p.clip && CLIPS_POSE.has(p.clip) && !p.bound) { cn++; if (!cw) cw = `${who}:${p.clip}`; }
          if (!owned && p.bound) { bn++; if (!bw) bw = who; }
          const a = dd.actors.find((q: any) => q.team === p.team && q.num === p.num);
          if (!owned && (claimOf(p) || (a && claimOf(a)))) { hn++; if (!hw) hw = who; }
          if (!owned && p.job && JOB_PHRASE.test(String(p.job))) { jn++; if (!jw) jw = `${who}:${p.job}`; }
          /* the mirror may not be AHEAD of what the engine owns: a published clip
           * the man does not have is a pose the renderer invented, and a published
           * pose the man does have is one it refused to let go. */
          if (a && ((p.clip ? CLIPS_POSE.has(p.clip) : false) !== (a.renderClip ? CLIPS_POSE.has(a.renderClip) : false))) {
            mn++; if (!mw) mw = `${who}:${p.clip}|${a.renderClip}`;
          }
        }
        acc('clip', cn, cw, f); acc('bound', bn, bw, f); acc('hip', hn, hw, f);
        acc('job', jn, jw, f); acc('mirror', mn, mw, f);
      }
      return out;
    };

    /** what a scenario measured on its way IN, kept for the exit checks to cite */
    const peaks = new Map<any, { plane: number; air: number; bnd: number }>();
    const rows: string[] = [];
    const scenario = (
      name: string,
      build: (dd: any) => string,          /* reach the state; report the claim */
      leave: (dd: any) => void,             /* the exit path, as the engine takes it */
      also?: (dd: any) => void,             /* anything only THIS exit can prove */
    ) => {
      const dd = fresh(31 + rows.length);
      const pre = build(dd);
      leave(dd);
      const r = sweep(dd);
      rows.push(`${name.padEnd(34)} pre:${pre.padEnd(26)} clip ${r.clip.worst}/${r.clip.last}`
        + ` bound ${r.bound.worst}/${r.bound.last} hips ${r.hip.worst}/${r.hip.last}`
        + ` job ${r.job.worst}/${r.job.last} mirror ${r.mirror.worst}/${r.mirror.last}`);
      check(`(f) ${name}`, () => {
        assert(r.clip.worst <= 1, `a man held a set-piece clip with no structure in the match for `
          + `${r.clip.worst} frames (${r.clip.who}, worst at f${r.clip.at}); the gait picker is supposed to take `
          + 'him back on the frame after the claim is gone');
        assert(r.bound.worst === 0, `${r.bound.worst} men were still CLAIMED (bound) by nothing anywhere in the `
          + `window (${r.bound.who} at f${r.bound.at}) — the picker declines to touch a bound man, so this is `
          + 'exactly how the scrum stranded its pose');
        assert(r.hip.worst === 0, `${r.hip.worst} men left this exit with scrum hip/bind channels still `
          + `published (${r.hip.who}) — a maul or lineout teardown that hands a man on with a crouch and a grip `
          + 'on nobody is the release bug wearing another shirt');
        assert(r.job.last === 0, `a man at the END of the window was still told ${r.job.who} — a HUD job with no `
          + 'owner, the same shape as the channels this pass removed');
        assert(r.mirror.worst === 0, `the published actor disagreed with the engine about who was posed on `
          + `${r.mirror.worst} frame(s) (${r.mirror.who}) — a renderer holding a clip the engine dropped is a `
          + 'pose that outlives its owner');
        if (also) also(dd);
      });
      return { dd, r };
    };

    /** drive the maul until the engine has both claimed AND posed its ranks;
     * `startMaul` flags `bound` on frame 0 itself, so a stage test alone would
     * let a scenario that never ran a single frame pass for a full one. */
    const maulTo = (dd: any, cap = 500) => until(dd,
      () => dd.ml?.stage === 'ATTACK_CONTROL' && dd.ml.t > 0.8 && poseWearers(dd) >= 12, cap);

    /* ---- (f1) A MAUL, WHISTLED AT FULL DRIVE: `releaseAll`, no teardownMaul ----
     * The whistle path does NOT purge maul clips by name (its clip list is
     * grounded/tackle/getup/jump only), so what saves the sixteen here is
     * `p.bound = false` + the picker. If that ever becomes conditional this goes
     * red, which is the point of measuring the worst frame and not just the last. */
    scenario(
      'A MAUL LOSES ITS CLAIM ON THE WHISTLE',
      (dd) => {
        dd.startMaul('A', 0, 0, MAUL_RANKS_PER_SIDE, false);
        assert(!!dd.ml, 'no maul to release — the scenario never started');
        const f = maulTo(dd);
        const c = claimCount(dd), w = poseWearers(dd);
        assert(f >= 12 && c >= 12 && w >= 12, `maul ran ${f} frames with ${c} bound and ${w} posed — the `
          + 'scenario never got a driven, posed pack, so the release below would prove nothing');
        return `${c} bound, ${w} posed, ${f}f`;
      },
      (dd) => dd.releaseAll(),
    );

    /* ---- (f2) A MAUL THAT EXITS BY ITSELF (the runner peel): `teardownMaul`, and
     * `releaseAll` is never called. The one path where the ONLY thing standing
     * between the sixteen and a permanent `maulBind` clip is that funnel —
     * `beginMaulExit` is what the law judge does; everything from that frame on is
     * the engine's own. The peel is also the case where one man legitimately
     * leaves early (`runnerLeaving` → 'carry') while the rest are still posed, so
     * the window catches a partial release. */
    scenario(
      'A MAUL LOSES ITS CLAIM ON A RUNNER EXIT',
      (dd) => {
        dd.startMaul('A', 0, 0, MAUL_RANKS_PER_SIDE, false);
        const f = maulTo(dd);
        const c = claimCount(dd), w = poseWearers(dd);
        assert(f >= 12 && c >= 12 && w >= 12, `maul ran ${f} frames with ${c} bound and ${w} posed — nothing `
          + 'to strand');
        const s = dd.ml;
        s.exit = 'PICK_AND_GO'; s.stage = 'EXIT'; s.exitT = 0; s.exitRunner = 7;
        const g = until(dd, () => !dd.ml, 400);
        assert(g >= 0, 'the maul never finished its exit beat — the window measured nothing');
        assert(!dd.bd && !dd.scrim, `the exit handed the men to ${dd.bd ? 'a ruck' : 'a scrum'}, not open play`);
        return `${c} bound, exit in ${g}f`;
      },
      (dd) => { /* already out: startOpen owns the phase */ },
    );

    /* ---- (f3) A LINEOUT, WHISTLED AT THE TOP OF THE LIFT ----
     * The user's specific worry, answered at both ends: the overhead press and the
     * upright plane are CLIP choices, so the purge that matters is the clip's; and
     * the plane itself is `handY` on the lineout's roster, so the check is that
     * the object holding it is gone and that no elevation was mirrored onto a man. */
    scenario(
      'A LINEOUT LOSES ITS CLAIM ON THE WHISTLE',
      (dd) => {
        dd.startLineout('A', 20, 6);
        assert(!!dd.lo, 'no lineout to release — the scenario never started');
        /* the PEAKS are tracked across the whole approach, not read off one frame:
         * `handY` only reaches its catch height on the frame the ball is won, and
         * `p.jumpY` is the channel a stranded plane would have to live on, so the
         * claim "the plane never touches a player" is measured, not assumed. */
        let plane = 0, air = 0, bnd = 0, f = -1;
        f = until(dd, () => {
          if (dd.lo) for (const slot of dd.lo.players) plane = Math.max(plane, slot.handY ?? 0);
          for (const p of dd.live) {
            if ((p.jumpY ?? 0) > air) air = p.jumpY;
            if (p.bound) bnd++;
          }
          /* whistle at the PEAK, not at the approach: the plane only exists on
           * the frame the ball is won (`handY = 2.6` is written by the catch), so
           * stopping at CONTEST would be measuring a lift that had not happened. */
          return plane >= 2.4 || dd.lo?.stage === 'CATCH';
        }, 900);
        assert(f >= 0, `the lineout never reached its contest or its catch (stage=${dd.lo?.stage})`);
        const w = poseWearers(dd);
        assert(w >= 2, `only ${w} men were in a jump or lift pose — nothing overhead to strand`);
        peaks.set(dd, { plane, air, bnd });
        return `${w} posed, ${bnd} bound, plane ${plane.toFixed(2)} m, actor height ${air.toFixed(2)} m`;
      },
      (dd) => dd.releaseAll(),
      (dd) => {
        const pk = peaks.get(dd) ?? { plane: 0, air: 0, bnd: 0 };
        assert(!dd.lo, 'the lineout state survived its own whistle — `handY` is still alive on it');
        /* THE PLANE IS NOT ON THE MAN. The authored catch plane is 2.6 m of hand
         * height (setpieces.ts writes it on the lineout's own roster entry) and
         * this scenario measured ${pk.plane.toFixed(2)} m of it at the whistle —
         * and NONE of it becomes a per-actor channel: the tallest man in the match
         * was ${pk.air.toFixed(2)} m off the deck on his OWN elevation channel,
         * which is the number a man who never jumped reaches. So the leak asked
         * about here — an elevated plane left running into open play — has no
         * channel to run on. What the lineout DOES write is a clip, and a clip is
         * re-derived by the picker on the frame the lineout stops writing it. */
        assert(pk.air < 0.05, `a lineout man was carried ${pk.air.toFixed(2)} m up on his OWN elevation `
          + 'channel — that is the channel a stranded plane would live on');
        assert(pk.plane > 2.4, `the lift peaked at ${pk.plane.toFixed(2)} m of hand height — the scenario `
          + 'never lifted anyone, so the check above proved nothing');
        for (const p of dd.live) {
          assert(!p.jumpY || p.jumpY <= 0, `shirt ${p.team}${p.num} still carries ${p.jumpY} m of elevation `
            + 'after the whistle — nothing owns him, so nothing is bringing him down');
        }
      },
    );

    /* ---- (f4) A LINEOUT THAT IS CAUGHT: no whistle anywhere near it ----
     * The engine's own completion (CATCH → the state closes → open play), so no
     * funnel with a purge list runs at all. What this case can prove is the claim
     * the others cannot: the posed men are released by NOTHING but the picker. */
    scenario(
      'A CAUGHT LINEOUT LETS GO WITHOUT A WHISTLE',
      (dd) => {
        dd.startLineout('A', 22, -6);
        let wore = 0;
        const f = until(dd, () => {
          wore = Math.max(wore, poseWearers(dd));
          return !dd.lo;
        }, 900);
        assert(f >= 0, `the lineout never closed (stage=${dd.lo?.stage} after 900 frames)`);
        assert(wore >= 2, `only ${wore} men were ever posed by the lineout — the close proves nothing`);
        let air = 0;
        for (const p of dd.live) if ((p.jumpY ?? 0) > 1e-6) air++;
        return `closed in ${f}f, ${wore} posed, ${air} elevated`;
      },
      (dd) => { /* the catch already handed the phase over */ },
    );

    /* ---- (f5) A LINEOUT THAT DRIVES INTO A MAUL ----
     * The only transition where a man could hold BOTH sets pieces' poses in one
     * frame, because the lineout never releases him — the maul just takes him. The
     * window's `owned` guard cannot see an overlap (the maul legitimately owns
     * them), so this one is counted at the hand-off itself. */
    scenario(
      'A LINEOUT THAT DRIVES DOES NOT WEAR TWO POSES',
      (dd) => {
        dd.startLineout('A', 24, 6);
        if (dd.lo) dd.lo.driveCall = true;
        const f = until(dd, () => !!dd.ml, 900);
        assert(f >= 0, `the drive call never became a maul (lo.stage=${dd.lo?.stage})`);
        let both = 0, maulN = 0;
        for (const p of dd.live) {
          if (p.clip === 'maulBind' || p.clip === 'maulDrive') maulN++;
          if (p.clip && String(p.clip).startsWith('lineout')) both++;
        }
        assert(maulN >= 8, `only ${maulN} men took a maul clip — the conversion never posed the pack`);
        return `${maulN} maul-posed, ${both} in lineout clips`;
      },
      (dd) => { /* the maul owns them; the sweep runs against a live maul */ },
      (dd) => {
        let both = 0, who = '';
        for (const p of dd.live) {
          if (p.clip && String(p.clip).startsWith('lineout')) { both++; if (!who) who = `${p.team}${p.num}:${p.clip}`; }
        }
        assert(both === 0, `${both} men were still in a lineout pose inside the maul that replaced it (${who}) `
          + '— two structures posing one body is the double-writer this pass keeps finding');
      },
    );

    /* The engine's own ledger, read from outside the module that writes it: a maul
     * exit promises zero leaked joints, zero unreleased bound bodies and zero drag
     * links, and (f2) is the path that writes it. */
    check('(f) THE MAUL TEARDOWN LEDGERS NOTHING', () => {
      const dd = fresh(77);
      dd.startMaul('A', 0, 0, MAUL_RANKS_PER_SIDE, false);
      assert(maulTo(dd) >= 12, 'the maul never posed its ranks — the ledger has nothing to clear');
      const s = dd.ml;
      s.exit = 'WHEEL_AND_PEEL'; s.stage = 'EXIT'; s.exitT = 0; s.exitRunner = 6;
      until(dd, () => !dd.ml, 400);
      const r = dd.lastTeardownResidual;
      assert(!!r, 'no teardown ledger was written for a maul that exited');
      assert(r.unreleasedBound === 0 && r.leakedJoints === 0 && r.dragLinks === 0,
        `maul exit residue: ${JSON.stringify(r)}`);
    });

    console.log('  --- set-piece release residue: worst/last frame of a 60-frame open-play window ---');
    for (const r of rows) console.log(`      ${r}`);
  }

  console.log(lines.join('\n'));
  console.log('');
  if (failures) {
    console.log(`BIND PROBE: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('BIND PROBE PASSES — 32 grips on the anatomy, the tunnel square, the hips grounded, '
    + 'the collapse seen, and the pack released clean');
}

main().catch((e) => { console.error(e); process.exit(1); });
